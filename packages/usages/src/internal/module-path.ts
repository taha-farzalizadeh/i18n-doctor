/**
 * Lightweight tsconfig paths resolution for cross-file usage indexes.
 * Avoids pulling @i18n-doctor/imports into the usages package.
 */

import fs from "node:fs";
import path from "node:path";

export interface AliasPathMap {
  readonly baseUrl: string;
  readonly paths: ReadonlyMap<string, readonly string[]>;
}

/** Set once per `collectUsages` run so import resolvers see tsconfig paths. */
let activeRoot: string | undefined;
const aliasCache = new Map<string, AliasPathMap | undefined>();

export function setModuleResolveRoot(root: string | undefined): void {
  activeRoot = root;
  // Root change must not reuse another project's path map.
  if (root === undefined) {
    aliasCache.clear();
  }
}

export function getActiveRoot(): string | undefined {
  return activeRoot;
}

function aliasesForRoot(root: string | undefined): AliasPathMap | undefined {
  if (!root) return undefined;
  const key = path.resolve(root);
  if (!aliasCache.has(key)) {
    aliasCache.set(key, loadAliasPathMap(key));
  }
  return aliasCache.get(key);
}

const TSCONFIG_CANDIDATES = [
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.web.json",
  "jsconfig.json",
] as const;

/**
 * Load baseUrl + paths, preferring a config that actually defines aliases.
 * Follows `extends` so Vite `tsconfig.json` → `tsconfig.app.json` works.
 */
export function loadAliasPathMap(root: string): AliasPathMap | undefined {
  let fallback: AliasPathMap | undefined;
  for (const name of TSCONFIG_CANDIDATES) {
    const configPath = path.join(root, name);
    const loaded = loadTsconfigAliasMap(configPath);
    if (!loaded) continue;
    if (loaded.paths.size > 0) {
      return loaded;
    }
    fallback ??= loaded;
  }
  return fallback;
}

function loadTsconfigAliasMap(
  configPath: string,
  seen: Set<string> = new Set(),
): AliasPathMap | undefined {
  const normalized = path.normalize(configPath);
  if (seen.has(normalized)) return undefined;
  seen.add(normalized);

  let text: string;
  try {
    text = fs.readFileSync(normalized, "utf8");
  } catch {
    return undefined;
  }
  const json = parseJsonc(text);
  if (!json || typeof json !== "object") return undefined;

  const configDir = path.dirname(normalized);
  const record = json as {
    extends?: unknown;
    compilerOptions?: unknown;
  };

  let parent: AliasPathMap | undefined;
  if (typeof record.extends === "string" && record.extends.length > 0) {
    const parentPath = resolveExtendsPath(configDir, record.extends);
    if (parentPath) {
      parent = loadTsconfigAliasMap(parentPath, seen);
    }
  }

  const opts =
    record.compilerOptions && typeof record.compilerOptions === "object"
      ? (record.compilerOptions as {
          baseUrl?: unknown;
          paths?: unknown;
        })
      : undefined;

  const baseUrl =
    opts && typeof opts.baseUrl === "string"
      ? path.resolve(configDir, opts.baseUrl)
      : (parent?.baseUrl ?? configDir);

  const paths = new Map<string, readonly string[]>(parent?.paths ?? []);
  if (opts?.paths && typeof opts.paths === "object") {
    for (const [pattern, targets] of Object.entries(
      opts.paths as Record<string, unknown>,
    )) {
      if (
        Array.isArray(targets) &&
        targets.every((t) => typeof t === "string")
      ) {
        paths.set(pattern, targets as string[]);
      }
    }
  }
  return { baseUrl, paths };
}

function resolveExtendsPath(
  configDir: string,
  extendsSpec: string,
): string | undefined {
  if (!extendsSpec.startsWith(".") && !path.isAbsolute(extendsSpec)) {
    return undefined;
  }
  const abs = path.isAbsolute(extendsSpec)
    ? extendsSpec
    : path.resolve(configDir, extendsSpec);
  const withJson = abs.endsWith(".json") ? abs : `${abs}.json`;
  if (fs.existsSync(withJson)) return withJson;
  if (fs.existsSync(abs)) return abs;
  return undefined;
}

/**
 * Resolve an import specifier to project-relative path bases (no extension),
 * using relative paths and the active project's tsconfig aliases.
 */
export function resolveModuleSpec(
  fromFileRel: string,
  moduleSpec: string,
  root: string | undefined = activeRoot,
  aliases: AliasPathMap | undefined = aliasesForRoot(root),
): readonly string[] {
  const fromRel = normalizeRel(fromFileRel);

  if (moduleSpec.startsWith(".")) {
    const slash = fromRel.lastIndexOf("/");
    const fromDir = slash >= 0 ? fromRel.slice(0, slash) : "";
    const joined = fromDir ? `${fromDir}/${moduleSpec}` : moduleSpec;
    return [normalizeRel(joined)];
  }

  if (!root || !aliases || aliases.paths.size === 0) return [];

  const absCandidates: string[] = [];
  const scored: { score: number; candidates: string[] }[] = [];
  for (const [pattern, targets] of aliases.paths) {
    const matched = matchPattern(moduleSpec, pattern);
    if (matched === undefined) continue;
    const candidates = targets.map((target) =>
      path.resolve(aliases.baseUrl, applyStar(target, matched)),
    );
    scored.push({ score: pattern.length, candidates });
  }
  scored.sort((a, b) => b.score - a.score);
  for (const entry of scored) absCandidates.push(...entry.candidates);

  const rootAbs = path.resolve(root);
  const out: string[] = [];
  for (const abs of absCandidates) {
    const rel = normalizeRel(path.relative(rootAbs, abs));
    if (rel && !rel.startsWith("..") && !out.includes(rel)) out.push(rel);
  }
  return out;
}

/** All file candidates for an import of `localName` from `fromFileRel`. */
export function resolveImportedFileCandidates(
  fromFileRel: string,
  moduleSpec: string,
): readonly string[] {
  const bases = resolveModuleSpec(fromFileRel, moduleSpec);
  const out: string[] = [];
  for (const base of bases) {
    for (const candidate of moduleFileCandidates(base)) {
      if (!out.includes(candidate)) out.push(candidate);
    }
  }
  return out;
}

export function moduleFileCandidates(base: string): readonly string[] {
  const normalized = normalizeRel(base);
  if (/\.[cm]?[jt]sx?$/.test(normalized)) return [normalized];
  return [
    `${normalized}.ts`,
    `${normalized}.tsx`,
    `${normalized}.js`,
    `${normalized}.jsx`,
    `${normalized}.mjs`,
    `${normalized}.cjs`,
    `${normalized}/index.ts`,
    `${normalized}/index.tsx`,
    `${normalized}/index.js`,
  ];
}

/**
 * Look up an index entry by file#name, with Windows-friendly case folding
 * when the exact key misses (Git checkout casing vs path.resolve).
 */
export function findIndexKey<T>(
  index: ReadonlyMap<string, T>,
  fileRel: string,
  name: string,
): { key: string; value: T } | undefined {
  const exact = `${normalizeRel(fileRel)}#${name}`;
  const hit = index.get(exact);
  if (hit !== undefined) return { key: exact, value: hit };

  if (process.platform !== "win32") return undefined;
  const needle = exact.toLowerCase();
  for (const [key, value] of index) {
    if (key.toLowerCase() === needle) return { key, value };
  }
  return undefined;
}

function matchPattern(specifier: string, pattern: string): string | undefined {
  if (!pattern.includes("*")) {
    return specifier === pattern ? "" : undefined;
  }
  const star = pattern.indexOf("*");
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) {
    return undefined;
  }
  if (specifier.length < prefix.length + suffix.length) {
    return undefined;
  }
  return specifier.slice(prefix.length, specifier.length - suffix.length);
}

function applyStar(target: string, star: string): string {
  const idx = target.indexOf("*");
  if (idx === -1) return target;
  return target.slice(0, idx) + star + target.slice(idx + 1);
}

function normalizeRel(rel: string): string {
  const parts: string[] = [];
  for (const part of rel.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function parseJsonc(text: string): unknown {
  let out = "";
  let i = 0;
  let inString = false;
  let quote = "";
  while (i < text.length) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\" && next) {
        out += next;
        i += 2;
        continue;
      }
      if (ch === quote) inString = false;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      i += 2;
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        i += 1;
      }
      i += 2;
      continue;
    }
    if (ch === "," && (next === "}" || next === "]")) {
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  try {
    return JSON.parse(out);
  } catch {
    return undefined;
  }
}
