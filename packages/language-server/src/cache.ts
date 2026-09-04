/**
 * Per-scope analysis cache and change classification.
 *
 * The analyzer's unit of work is a project scope, so responsiveness comes from
 * reusing whichever half of the pipeline a change cannot have affected:
 * editing a component invalidates usage detection but not the translation
 * catalog, and editing a locale file does the opposite.
 */

import path from "node:path";
import type { CoverageResult } from "@i18n-doctor/coverage";
import type { AnalysisResult, MatchContext } from "@i18n-doctor/issues";
import type { TranslationCatalog } from "@i18n-doctor/sources";
import type { TranslationIndex } from "@i18n-doctor/translation-index";
import type { UsageCatalog } from "@i18n-doctor/usages";
import { isConfigPath, isWithin, pathKey, type PlatformId } from "./workspace.js";

/** Which halves of the pipeline a change invalidates. */
export interface Invalidation {
  /** Re-run translation source discovery. */
  readonly sources: boolean;
  /** Re-run usage detection. */
  readonly usages: boolean;
  /** Re-resolve config, scopes, and framework detection. */
  readonly config: boolean;
}

export const INVALIDATE_ALL: Invalidation = {
  sources: true,
  usages: true,
  config: true,
};

const TRANSLATION_EXTENSIONS = new Set([".json", ".yaml", ".yml"]);
const CODE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".vue",
  ".svelte",
  ".astro",
  ".html",
  ".htm",
]);

export interface ScopeCacheEntry {
  readonly scopeRoot: string;
  sourceCatalog?: TranslationCatalog;
  usageCatalog?: UsageCatalog;
  analysis?: AnalysisResult;
  coverage?: CoverageResult;
  /** Derived from sourceCatalog; rebuilt when sources refresh. */
  translationIndex?: TranslationIndex;
  matchContext?: MatchContext;
  preferredLocales?: readonly string[];
  /** Set when the last analysis attempt failed; kept for logging only. */
  lastError?: string;
  dirty: Invalidation;
}

export interface AnalysisCache {
  /** Cache entry for a scope, created on first use. */
  entry(scopeRoot: string): ScopeCacheEntry;
  /** True when any pipeline half needs re-running for this scope. */
  isDirty(scopeRoot: string): boolean;
  /** True when any tracked scope needs re-running. */
  anyDirty(): boolean;
  /** Marks a scope's halves dirty. */
  invalidateScope(scopeRoot: string, invalidation: Invalidation): void;
  /**
   * Marks the scopes containing `absolutePath` dirty, based on what the file is.
   * Returns the invalidation that was applied.
   */
  invalidateFile(absolutePath: string): Invalidation;
  invalidateAll(): void;
  /** Drops cached catalogs for scopes that no longer exist. */
  retainScopes(scopeRoots: readonly string[]): void;
  /** Clears every entry — used when config or workspace layout changes. */
  reset(): void;
  /** Classifies a change without mutating cache state. */
  classify(absolutePath: string): Invalidation;
}

export function createAnalysisCache(options?: {
  readonly platform?: PlatformId;
}): AnalysisCache {
  const platform = options?.platform;
  const entries = new Map<string, ScopeCacheEntry>();

  const keyOf = (scopeRoot: string): string => pathKey(scopeRoot, platform);

  const entry = (scopeRoot: string): ScopeCacheEntry => {
    const key = keyOf(scopeRoot);
    const existing = entries.get(key);
    if (existing) return existing;
    const created: ScopeCacheEntry = {
      scopeRoot,
      dirty: { ...INVALIDATE_ALL },
    };
    entries.set(key, created);
    return created;
  };

  const classify = (absolutePath: string): Invalidation => {
    if (isConfigPath(absolutePath)) return { ...INVALIDATE_ALL };

    const extension = path.extname(absolutePath).toLowerCase();
    const isKnownSource = [...entries.values()].some((e) =>
      catalogContains(e.sourceCatalog, absolutePath, platform),
    );

    if (isKnownSource) {
      // A `.ts` catalog module can hold both definitions and `t()` calls.
      return {
        sources: true,
        usages: CODE_EXTENSIONS.has(extension),
        config: false,
      };
    }
    if (TRANSLATION_EXTENSIONS.has(extension)) {
      return { sources: true, usages: false, config: false };
    }
    if (CODE_EXTENSIONS.has(extension)) {
      // A new file may become a catalog module, so refresh sources too.
      return { sources: true, usages: true, config: false };
    }
    return { sources: true, usages: true, config: false };
  };

  const apply = (target: ScopeCacheEntry, next: Invalidation): void => {
    target.dirty = {
      sources: target.dirty.sources || next.sources,
      usages: target.dirty.usages || next.usages,
      config: target.dirty.config || next.config,
    };
    // Index is derived from the source catalog — drop it when sources go dirty.
    if (next.sources || next.config) {
      delete target.translationIndex;
    }
  };

  return {
    entry,

    isDirty(scopeRoot) {
      const found = entries.get(keyOf(scopeRoot));
      if (!found) return true;
      return found.dirty.sources || found.dirty.usages || found.dirty.config;
    },

    anyDirty() {
      for (const value of entries.values()) {
        if (value.dirty.sources || value.dirty.usages || value.dirty.config) {
          return true;
        }
      }
      return entries.size === 0;
    },

    invalidateScope(scopeRoot, invalidation) {
      apply(entry(scopeRoot), invalidation);
    },

    invalidateFile(absolutePath) {
      const invalidation = classify(absolutePath);
      let matched = false;
      for (const value of entries.values()) {
        if (!isWithin(value.scopeRoot, absolutePath, platform)) continue;
        apply(value, invalidation);
        matched = true;
      }
      // A file outside every known scope (or before the first analysis)
      // still forces a refresh rather than silently going unanalyzed.
      if (!matched) {
        for (const value of entries.values()) apply(value, invalidation);
      }
      return invalidation;
    },

    invalidateAll() {
      for (const value of entries.values()) {
        value.dirty = { ...INVALIDATE_ALL };
      }
    },

    retainScopes(scopeRoots) {
      const keep = new Set(scopeRoots.map(keyOf));
      for (const key of [...entries.keys()]) {
        if (!keep.has(key)) entries.delete(key);
      }
    },

    reset() {
      entries.clear();
    },

    classify,
  };
}

function catalogContains(
  catalog: TranslationCatalog | undefined,
  absolutePath: string,
  platform: PlatformId | undefined,
): boolean {
  if (!catalog) return false;
  const target = pathKey(absolutePath, platform);
  for (const source of catalog.sources) {
    const candidate = path.isAbsolute(source.filePath)
      ? source.filePath
      : path.join(catalog.root, source.filePath);
    if (pathKey(candidate, platform) === target) return true;
  }
  return false;
}
