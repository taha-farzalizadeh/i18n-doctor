import path from "node:path";
import type { FsAccess } from "./fs-access.js";
import { toPosix } from "./location.js";

export interface TsconfigPathMap {
  readonly configPath: string;
  readonly baseUrl: string;
  /** Pattern → list of target patterns (relative to baseUrl). */
  readonly paths: ReadonlyMap<string, readonly string[]>;
}

const TSCONFIG_CANDIDATES = [
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.web.json",
  "jsconfig.json",
] as const;

/**
 * Load baseUrl + paths from a tsconfig.json (JSONC-tolerant).
 * Follows `extends` (child overrides parent) so Vite-style
 * `tsconfig.json` → `tsconfig.app.json` projects resolve aliases.
 */
export function loadTsconfigPaths(
  tsconfigPath: string,
  fsAccess: FsAccess,
  seen: Set<string> = new Set(),
): TsconfigPathMap | undefined {
  const normalized = path.normalize(tsconfigPath);
  if (seen.has(normalized)) {
    return undefined;
  }
  seen.add(normalized);

  const text = fsAccess.readFile(normalized);
  if (text === undefined) {
    return undefined;
  }
  const json = parseJsonc(text);
  if (!json || typeof json !== "object") {
    return undefined;
  }

  const configDir = path.dirname(normalized);
  const record = json as {
    extends?: unknown;
    compilerOptions?: unknown;
  };

  let parent: TsconfigPathMap | undefined;
  if (typeof record.extends === "string" && record.extends.length > 0) {
    const parentPath = resolveExtendsPath(configDir, record.extends, fsAccess);
    if (parentPath) {
      parent = loadTsconfigPaths(parentPath, fsAccess, seen);
    }
  }

  const compilerOptions =
    record.compilerOptions && typeof record.compilerOptions === "object"
      ? (record.compilerOptions as {
          baseUrl?: unknown;
          paths?: unknown;
        })
      : undefined;

  const baseUrl =
    compilerOptions && typeof compilerOptions.baseUrl === "string"
      ? path.resolve(configDir, compilerOptions.baseUrl)
      : (parent?.baseUrl ?? configDir);

  const paths = new Map<string, readonly string[]>(parent?.paths ?? []);
  if (compilerOptions?.paths && typeof compilerOptions.paths === "object") {
    for (const [pattern, targets] of Object.entries(
      compilerOptions.paths as Record<string, unknown>,
    )) {
      if (
        Array.isArray(targets) &&
        targets.every((t) => typeof t === "string")
      ) {
        paths.set(pattern, targets as string[]);
      }
    }
  }

  return { configPath: normalized, baseUrl, paths };
}

/**
 * Map a specifier through tsconfig paths.
 *
 * - Prefer explicit `paths` patterns (longest match wins).
 * - Use baseUrl fallback ONLY when no paths are configured
 *   (avoids resolving `react` → `<baseUrl>/react`).
 */
export function matchTsconfigPaths(
  specifier: string,
  map: TsconfigPathMap,
): string[] {
  if (map.paths.size > 0) {
    const scored: { score: number; candidates: string[] }[] = [];
    for (const [pattern, targets] of map.paths) {
      const matched = matchPattern(specifier, pattern);
      if (matched === undefined) {
        continue;
      }
      const candidates = targets.map((target) =>
        path.resolve(map.baseUrl, applyStar(target, matched)),
      );
      scored.push({ score: pattern.length, candidates });
    }
    scored.sort((a, b) => b.score - a.score);
    const out: string[] = [];
    for (const entry of scored) {
      out.push(...entry.candidates);
    }
    return out;
  }

  // No paths map — allow baseUrl-relative resolution for project files.
  if (!specifier.startsWith(".")) {
    return [path.resolve(map.baseUrl, specifier)];
  }
  return [];
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
  if (idx === -1) {
    return target;
  }
  return target.slice(0, idx) + star + target.slice(idx + 1);
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
      if (ch === quote) {
        inString = false;
      }
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

function resolveExtendsPath(
  configDir: string,
  extendsSpec: string,
  fsAccess: FsAccess,
): string | undefined {
  // Local / relative extends (./tsconfig.app.json, ../tsconfig.base.json)
  if (extendsSpec.startsWith(".") || path.isAbsolute(extendsSpec)) {
    const abs = path.isAbsolute(extendsSpec)
      ? extendsSpec
      : path.resolve(configDir, extendsSpec);
    const withJson = abs.endsWith(".json") ? abs : `${abs}.json`;
    if (fsAccess.fileExists(withJson)) return withJson;
    if (fsAccess.fileExists(abs)) return abs;
    return undefined;
  }

  // Skip bare npm package extends (e.g. @tsconfig/strict) — not needed for paths.
  return undefined;
}

/**
 * Pick the project tsconfig that best exposes path aliases.
 * Prefers a config that actually defines `paths` (or inherits them via extends).
 */
export function defaultTsconfigPath(
  root: string,
  fsAccess: FsAccess,
): string | undefined {
  const candidates = TSCONFIG_CANDIDATES.map((name) => path.join(root, name));
  let fallback: string | undefined;
  for (const candidate of candidates) {
    if (!fsAccess.fileExists(candidate)) continue;
    const loaded = loadTsconfigPaths(candidate, fsAccess);
    if (!loaded) continue;
    if (loaded.paths.size > 0) {
      return candidate;
    }
    fallback ??= candidate;
  }
  return fallback;
}

export function describePathMap(map: TsconfigPathMap): string {
  return `${toPosix(map.configPath)} (baseUrl=${toPosix(map.baseUrl)}, paths=${map.paths.size})`;
}
