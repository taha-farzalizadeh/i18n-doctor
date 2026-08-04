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
      const hit = matchesAny(key, ignoreKeys);
      return hit
        ? { ignored: true, pattern: hit.pattern, kind: "ignoreKeys" }
        : { ignored: false };
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

export const ignoreEngineFactory: IgnoreEngineFactory = {
  createIgnoreEngine,
};
