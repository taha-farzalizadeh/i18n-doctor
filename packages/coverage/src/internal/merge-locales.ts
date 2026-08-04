/**
 * Locale Merger — group catalog keys by namespace/locale without re-parsing.
 */

import type {
  TranslationCatalog,
  TranslationKeyDefinition,
} from "@i18n-unused/sources";
import type {
  CoverageDiagnostic,
  MergedLocaleModel,
  MergedLocaleNamespace,
} from "../api/types.js";
import { buildLocaleTree, emptyLocaleTree } from "./build-tree.js";

const DEFAULT_NS = "*";

export interface MergeOptions {
  readonly locales?: readonly string[];
  readonly namespaces?: readonly string[];
  readonly ignoreKeys?: readonly string[];
  readonly minConfidence?: number;
  /**
   * Build nested LocaleTree per namespace.
   * Disable for large catalogs when only flat coverage is needed.
   * @default true
   */
  readonly buildTrees?: boolean;
}

/**
 * Merge one or more catalogs into a unified per-namespace model.
 * Monorepo: pass multiple catalogs (one per package); keys keep their paths.
 */
export function mergeLocaleCatalogs(
  catalogs: readonly TranslationCatalog[],
  options: MergeOptions = {},
): MergedLocaleModel {
  if (catalogs.length === 0) {
    return {
      root: "",
      locales: [],
      namespaces: [],
      byNamespace: new Map(),
      diagnostics: [],
    };
  }

  const root = catalogs[0]!.root;
  const minConfidence = options.minConfidence ?? 0;
  const ignore = compileIgnore(options.ignoreKeys);
  const localeFilter = options.locales ? new Set(options.locales) : undefined;
  const nsFilter = options.namespaces
    ? new Set(options.namespaces)
    : undefined;
  const buildTrees = options.buildTrees !== false;

  // namespace → key → locale → def
  const buckets = new Map<
    string,
    Map<string, Map<string, TranslationKeyDefinition>>
  >();
  const localeSet = new Set<string>();
  const diagnostics: CoverageDiagnostic[] = [];

  // Track duplicate definitions: ns\0key\0locale → first filePath
  const seen = new Map<string, string>();

  for (const catalog of catalogs) {
    for (const keyDef of catalog.keys) {
      if (keyDef.confidence < minConfidence) continue;
      if (!keyDef.locale) continue;
      if (localeFilter && !localeFilter.has(keyDef.locale)) continue;

      const ns = keyDef.namespace ?? DEFAULT_NS;
      if (nsFilter && !nsFilter.has(ns)) continue;
      if (isIgnored(keyDef.key, ignore)) continue;

      localeSet.add(keyDef.locale);

      let byKey = buckets.get(ns);
      if (!byKey) {
        byKey = new Map();
        buckets.set(ns, byKey);
      }
      let byLocale = byKey.get(keyDef.key);
      if (!byLocale) {
        byLocale = new Map();
        byKey.set(keyDef.key, byLocale);
      }

      const dupId = `${ns}\0${keyDef.key}\0${keyDef.locale}`;
      const existing = byLocale.get(keyDef.locale);
      if (existing) {
        const prevPath = seen.get(dupId) ?? existing.filePath;
        if (prevPath !== keyDef.filePath) {
          diagnostics.push({
            code: "duplicate-locale-definition",
            severity: "warning",
            message: `Duplicate definition of "${keyDef.key}" for locale "${keyDef.locale}" in ${prevPath} and ${keyDef.filePath}`,
            hint: "Keep a single definition per locale/namespace/key.",
          });
        }
        if (keyDef.confidence > existing.confidence) {
          byLocale.set(keyDef.locale, keyDef);
          seen.set(dupId, keyDef.filePath);
        }
      } else {
        byLocale.set(keyDef.locale, keyDef);
        seen.set(dupId, keyDef.filePath);
      }
    }
  }

  const locales = [...localeSet].sort((a, b) => a.localeCompare(b));
  const namespaces = [...buckets.keys()].sort((a, b) => {
    if (a === DEFAULT_NS) return 1;
    if (b === DEFAULT_NS) return -1;
    return a.localeCompare(b);
  });

  const byNamespace = new Map<string, MergedLocaleNamespace>();
  for (const ns of namespaces) {
    const entries = buckets.get(ns)!;
    const nsOpt = ns === DEFAULT_NS ? undefined : ns;
    const tree = buildTrees
      ? buildLocaleTree(entries, locales, nsOpt)
      : emptyLocaleTree(locales, nsOpt);
    const merged: MergedLocaleNamespace = {
      ...(nsOpt !== undefined ? { namespace: nsOpt } : {}),
      locales,
      tree,
      entries,
    };
    byNamespace.set(ns, merged);
  }

  // Stable diagnostic order
  diagnostics.sort((a, b) => a.message.localeCompare(b.message));

  return { root, locales, namespaces, byNamespace, diagnostics };
}

function compileIgnore(
  patterns: readonly string[] | undefined,
): readonly { exact?: string; prefix?: string }[] {
  if (!patterns?.length) return [];
  return patterns.map((p) => {
    if (p.endsWith(".*") || p.endsWith("*")) {
      const prefix = p.replace(/\.\*$/, "").replace(/\*$/, "");
      return { prefix };
    }
    return { exact: p };
  });
}

function isIgnored(
  key: string,
  rules: readonly { exact?: string; prefix?: string }[],
): boolean {
  for (const r of rules) {
    if (r.exact !== undefined && key === r.exact) return true;
    if (
      r.prefix !== undefined &&
      (key === r.prefix || key.startsWith(`${r.prefix}.`))
    ) {
      return true;
    }
  }
  return false;
}

export { DEFAULT_NS };
