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
}

export function getActiveRoot(): string | undefined {
  return activeRoot;
}

function aliasesForRoot(root: string | undefined): AliasPathMap | undefined {
  if (!root) return undefined;
  if (!aliasCache.has(root)) {
    aliasCache.set(root, loadAliasPathMap(root));
  }
  return aliasCache.get(root);
}

export function loadAliasPathMap(root: string): AliasPathMap | undefined {
  const candidates = [
    path.join(root, "tsconfig.json"),
    path.join(root, "tsconfig.app.json"),
    path.join(root, "jsconfig.json"),
  ];
  for (const configPath of candidates) {
    let text: string;
    try {
      text = fs.readFileSync(configPath, "utf8");
    } catch {
      continue;
    }
    const json = parseJsonc(text);
    if (!json || typeof json !== "object") continue;
    const opts = (json as { compilerOptions?: Record<string, unknown> })
      .compilerOptions;
    if (!opts || typeof opts !== "object") continue;

    const configDir = path.dirname(configPath);
    const baseUrl =
      typeof opts.baseUrl === "string"
        ? path.resolve(configDir, opts.baseUrl)
        : configDir;

    const paths = new Map<string, readonly string[]>();
    if (opts.paths && typeof opts.paths === "object") {
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
  if (moduleSpec.startsWith(".")) {
    const fromDir = fromFileRel.includes("/")
      ? fromFileRel.slice(0, fromFileRel.lastIndexOf("/"))
      : "";
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
