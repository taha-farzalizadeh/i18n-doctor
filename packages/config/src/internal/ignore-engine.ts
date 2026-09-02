import type { IgnoreEngine, IgnoreEngineFactory } from "../api/resolver.js";
import type { IgnoreMatch } from "../api/types.js";
import {
  compileGlob,
  matchesAny,
  toPosixRelative,
  type CompiledGlob,
} from "./glob.js";

export function createIgnoreEngine(config: {
  readonly ignoreKeys?: readonly string[];
  readonly ignoreFiles?: readonly string[];
  readonly ignoreLocales?: readonly string[];
  readonly ignoreNamespaces?: readonly string[];
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}): IgnoreEngine {
  // Keys / locales / namespaces: exact glob on full string (no basename fallback)
  const ignoreKeys = compileAll(config.ignoreKeys, false);
  const ignoreLocales = compileAll(config.ignoreLocales, false);
  const ignoreNamespaces = compileAll(config.ignoreNamespaces, false);
  // File paths: basename fallback for patterns like *.stories.tsx
  const ignoreFiles = compileAll(config.ignoreFiles, true);
  const include = compileAll(config.include, true);
  const exclude = compileAll(config.exclude, true);

  return {
    isKeyIgnored(key) {
      // Match the full key (`auth.login`, `SERVER_USER`) and common variants:
      // leaf after `.` / after `:` so patterns like `SERVER_*` also catch
      // `common:SERVER_USER` and `errors.SERVER_USER`.
      for (const candidate of keyIgnoreCandidates(key)) {
        const hit = matchesAny(candidate, ignoreKeys);
        if (hit) {
          return { ignored: true, pattern: hit.pattern, kind: "ignoreKeys" };
        }
      }
      return { ignored: false };
    },
    isFileIgnored(relativePath) {
      const path = toPosixRelative(relativePath);
      const hit = matchesAny(path, ignoreFiles);
      return hit
        ? { ignored: true, pattern: hit.pattern, kind: "ignoreFiles" }
        : { ignored: false };
    },
    isLocaleIgnored(locale) {
      const hit = matchesAny(locale, ignoreLocales);
      return hit
        ? { ignored: true, pattern: hit.pattern, kind: "ignoreLocales" }
        : { ignored: false };
    },
    isNamespaceIgnored(namespace) {
      const hit = matchesAny(namespace, ignoreNamespaces);
      return hit
        ? { ignored: true, pattern: hit.pattern, kind: "ignoreNamespaces" }
        : { ignored: false };
    },
    shouldAnalyzeFile(relativePath) {
      return explainFile(relativePath, include, exclude, ignoreFiles);
    },
    explainFile(relativePath) {
      return explainFile(relativePath, include, exclude, ignoreFiles);
    },
  };
}

function explainFile(
  relativePath: string,
  include: readonly CompiledGlob[],
  exclude: readonly CompiledGlob[],
  ignoreFiles: readonly CompiledGlob[],
): IgnoreMatch {
  const path = toPosixRelative(relativePath);

  const ignored = matchesAny(path, ignoreFiles);
  if (ignored) {
    return { ignored: true, pattern: ignored.pattern, kind: "ignoreFiles" };
  }

  const excluded = matchesAny(path, exclude);
  if (excluded) {
    return { ignored: true, pattern: excluded.pattern, kind: "exclude" };
  }

  if (include.length === 0) {
    return { ignored: false };
  }

  const included = matchesAny(path, include);
  if (!included) {
    return {
      ignored: true,
      pattern: include.map((g) => g.pattern).join(", "),
      kind: "include",
    };
  }

  return { ignored: false, pattern: included.pattern, kind: "include" };
}

function compileAll(
  patterns: readonly string[] | undefined,
  basenameFallback: boolean,
): CompiledGlob[] {
  if (!patterns || patterns.length === 0) return [];
  return patterns.map((p) => compileGlob(p, { basenameFallback }));
}

/** Unique key shapes to test against ignoreKeys patterns. */
export function keyIgnoreCandidates(key: string): readonly string[] {
  const out: string[] = [];
  const push = (value: string) => {
    if (value.length > 0 && !out.includes(value)) out.push(value);
  };
  push(key);
  const afterColon = key.includes(":")
    ? key.slice(key.lastIndexOf(":") + 1)
    : undefined;
  if (afterColon !== undefined) push(afterColon);
  const dotted = afterColon ?? key;
  if (dotted.includes(".")) {
    push(dotted.slice(dotted.lastIndexOf(".") + 1));
  }
  return out;
}

export const ignoreEngineFactory: IgnoreEngineFactory = {
  createIgnoreEngine,
};
