/**
 * Merge multiple TranslationConfig fragments into EffectiveI18nSettings.
 * Conflicting values are recorded; higher-confidence / preferred library wins.
 */

import type {
  ConfigConflict,
  ConfigLibraryId,
  EffectiveI18nSettings,
  ResolutionSource,
  TranslationConfig,
} from "../api/types.js";
import { firstString } from "./extractors/shared.js";
import { roundConfidence } from "./location.js";

const LIBRARY_PRIORITY: Record<ConfigLibraryId, number> = {
  "next-intl": 6,
  "next-i18next": 5,
  "react-i18next": 4,
  i18next: 3,
  "nuxt-i18n": 3,
  "vue-i18n": 2,
  unknown: 0,
};

interface FieldPick<T> {
  value: T;
  confidence: number;
  source: ResolutionSource;
  path: string;
}

export function mergeConfigs(
  configs: readonly TranslationConfig[],
  preferredLibrary?: ConfigLibraryId,
): EffectiveI18nSettings {
  const conflicts: ConfigConflict[] = [];
  const fieldSources: Record<string, ResolutionSource> = {};

  // Stable sort: higher score first; tie-break by path for determinism
  const ranked = [...configs].sort((a, b) => {
    const diff = score(b, preferredLibrary) - score(a, preferredLibrary);
    if (diff !== 0) return diff;
    return a.relativePath.localeCompare(b.relativePath) || a.id.localeCompare(b.id);
  });

  const defaultNS = pickStringField(ranked, "defaultNS", "defaultNS", conflicts, fieldSources);
  const fallbackNS = pickStringListField(
    ranked,
    "fallbackNS",
    "fallbackNS",
    conflicts,
    fieldSources,
  );
  const namespaces = pickStringListField(
    ranked,
    "ns",
    "config-ns",
    conflicts,
    fieldSources,
    "namespaces",
  );
  const defaultLocale = pickStringField(
    ranked,
    "defaultLocale",
    "default-locale",
    conflicts,
    fieldSources,
  );
  const fallbackLocales = pickStringListField(
    ranked,
    "fallbackLocale",
    "fallback-locale",
    conflicts,
    fieldSources,
    "fallbackLocales",
  );
  const supportedLocales = pickStringListField(
    ranked,
    "supportedLocales",
    "supported-locales",
    conflicts,
    fieldSources,
  );

  const inheritance = mergeInheritance(ranked, conflicts, fieldSources);

  let keySeparator = ".";
  let nsSeparator = ":";
  for (const c of ranked) {
    if (c.keySeparator !== undefined) {
      keySeparator = c.keySeparator;
      fieldSources.keySeparator = "inferred";
      break;
    }
  }
  for (const c of ranked) {
    if (c.nsSeparator !== undefined) {
      nsSeparator = c.nsSeparator;
      fieldSources.nsSeparator = "inferred";
      break;
    }
  }

  const confidences = ranked.map((c) => c.confidence);
  const confidence =
    confidences.length === 0
      ? 0
      : roundConfidence(
          confidences.reduce((a, b) => a + b, 0) / confidences.length,
        );

  return {
    ...(defaultNS !== undefined ? { defaultNS } : {}),
    ...(fallbackNS !== undefined ? { fallbackNS } : {}),
    ...(namespaces !== undefined ? { namespaces } : {}),
    ...(defaultLocale !== undefined ? { defaultLocale } : {}),
    ...(fallbackLocales !== undefined ? { fallbackLocales } : {}),
    ...(supportedLocales !== undefined ? { supportedLocales } : {}),
    ...(inheritance !== undefined ? { localeInheritance: inheritance } : {}),
    keySeparator,
    nsSeparator,
    fieldSources,
    confidence,
    conflicts,
  };
}

function score(
  config: TranslationConfig,
  preferred?: ConfigLibraryId,
): number {
  const lib =
    LIBRARY_PRIORITY[config.library] +
    (preferred && config.library === preferred ? 10 : 0);
  return lib + config.confidence;
}

function pickStringField(
  ranked: readonly TranslationConfig[],
  field: keyof TranslationConfig,
  source: ResolutionSource,
  conflicts: ConfigConflict[],
  fieldSources: Record<string, ResolutionSource>,
): string | undefined {
  const picks: FieldPick<string>[] = [];
  for (const c of ranked) {
    const raw = c[field];
    const value = firstString(raw as string | readonly string[] | undefined);
    if (value !== undefined) {
      picks.push({
        value,
        confidence: c.confidence,
        source,
        path: c.relativePath,
      });
    }
  }
  if (picks.length === 0) {
    return undefined;
  }
  const winner = picks[0]!;
  const distinct = [...new Set(picks.map((p) => p.value))];
  if (distinct.length > 1) {
    conflicts.push({
      field: String(field),
      values: distinct,
      paths: picks.map((p) => p.path),
      message: `Conflicting ${String(field)}: ${distinct.join(" vs ")} — using ${winner.value} from ${winner.path}`,
    });
  }
  fieldSources[String(field)] = source;
  return winner.value;
}

function pickStringListField(
  ranked: readonly TranslationConfig[],
  field: keyof TranslationConfig,
  source: ResolutionSource,
  conflicts: ConfigConflict[],
  fieldSources: Record<string, ResolutionSource>,
  sourceKey?: string,
): readonly string[] | undefined {
  const picks: FieldPick<readonly string[]>[] = [];
  for (const c of ranked) {
    const raw = c[field] as string | readonly string[] | undefined;
    if (raw === undefined) continue;
    const list = typeof raw === "string" ? [raw] : [...raw];
    if (list.length > 0) {
      picks.push({
        value: list,
        confidence: c.confidence,
        source,
        path: c.relativePath,
      });
    }
  }
  if (picks.length === 0) {
    return undefined;
  }
  // Union namespaces / locales for broader coverage; first list wins order.
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const p of picks) {
    for (const v of p.value) {
      if (!seen.has(v)) {
        seen.add(v);
        merged.push(v);
      }
    }
  }
  const key = sourceKey ?? String(field);
  fieldSources[key] = source;

  // Record conflict when first two lists disagree on membership
  if (picks.length > 1) {
    const a = new Set(picks[0]!.value);
    const b = new Set(picks[1]!.value);
    const onlyA = [...a].filter((x) => !b.has(x));
    const onlyB = [...b].filter((x) => !a.has(x));
    if (onlyA.length > 0 || onlyB.length > 0) {
      conflicts.push({
        field: key,
        values: picks.map((p) => p.value.join(",")),
        paths: picks.map((p) => p.path),
        message: `Merged differing ${key} lists from ${picks.length} configs`,
      });
    }
  }

  return merged;
}

function mergeInheritance(
  ranked: readonly TranslationConfig[],
  conflicts: ConfigConflict[],
  fieldSources: Record<string, ResolutionSource>,
): Readonly<Record<string, string>> | undefined {
  const out: Record<string, string> = {};
  const sources: Record<string, string> = {};
  for (const c of ranked) {
    if (!c.localeInheritance) continue;
    for (const [child, parent] of Object.entries(c.localeInheritance)) {
      if (out[child] !== undefined && out[child] !== parent) {
        conflicts.push({
          field: "localeInheritance",
          values: [out[child]!, parent],
          paths: [sources[child] ?? "?", c.relativePath],
          message: `Conflicting inheritance for ${child}: ${out[child]} vs ${parent}`,
        });
        continue;
      }
      if (out[child] === undefined) {
        out[child] = parent;
        sources[child] = c.relativePath;
      }
    }
  }
  if (Object.keys(out).length === 0) {
    return undefined;
  }
  fieldSources.localeInheritance = "locale-inheritance";
  return out;
}
