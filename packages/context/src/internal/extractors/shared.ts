import type {
  ConfigKind,
  ConfigLibraryId,
  Confidence,
  SourceLocation,
  TranslationConfig,
} from "../../api/types.js";
import { roundConfidence } from "../location.js";

export interface ConfigDraft {
  readonly kind: ConfigKind;
  readonly library: ConfigLibraryId;
  readonly confidence: Confidence;
  readonly defaultNS?: string | readonly string[];
  readonly fallbackNS?: string | readonly string[];
  readonly ns?: readonly string[];
  readonly defaultLocale?: string;
  readonly fallbackLocale?: string | readonly string[];
  readonly supportedLocales?: readonly string[];
  readonly localeInheritance?: Readonly<Record<string, string>>;
  readonly keySeparator?: string;
  readonly nsSeparator?: string;
  readonly evidence: readonly string[];
  readonly location?: SourceLocation;
}

export function buildConfig(args: {
  absolutePath: string;
  relativePath: string;
  packageRoot?: string;
  index: number;
  draft: ConfigDraft;
}): TranslationConfig {
  const { absolutePath, relativePath, packageRoot, index, draft } = args;
  const id = `${relativePath}#${draft.kind}#${index}`;
  return {
    id,
    absolutePath,
    relativePath,
    kind: draft.kind,
    library: draft.library,
    confidence: roundConfidence(draft.confidence),
    ...(draft.defaultNS !== undefined ? { defaultNS: draft.defaultNS } : {}),
    ...(draft.fallbackNS !== undefined ? { fallbackNS: draft.fallbackNS } : {}),
    ...(draft.ns !== undefined ? { ns: draft.ns } : {}),
    ...(draft.defaultLocale !== undefined
      ? { defaultLocale: draft.defaultLocale }
      : {}),
    ...(draft.fallbackLocale !== undefined
      ? { fallbackLocale: draft.fallbackLocale }
      : {}),
    ...(draft.supportedLocales !== undefined
      ? { supportedLocales: draft.supportedLocales }
      : {}),
    ...(draft.localeInheritance !== undefined
      ? { localeInheritance: draft.localeInheritance }
      : {}),
    ...(draft.keySeparator !== undefined
      ? { keySeparator: draft.keySeparator }
      : {}),
    ...(draft.nsSeparator !== undefined
      ? { nsSeparator: draft.nsSeparator }
      : {}),
    evidence: draft.evidence,
    ...(draft.location !== undefined ? { location: draft.location } : {}),
    ...(packageRoot !== undefined ? { packageRoot } : {}),
  };
}

export function hasAnySetting(draft: ConfigDraft): boolean {
  return (
    draft.defaultNS !== undefined ||
    draft.fallbackNS !== undefined ||
    draft.ns !== undefined ||
    draft.defaultLocale !== undefined ||
    draft.fallbackLocale !== undefined ||
    draft.supportedLocales !== undefined ||
    draft.localeInheritance !== undefined ||
    draft.keySeparator !== undefined ||
    draft.nsSeparator !== undefined
  );
}

/**
 * Normalize locale tokens to lowercase BCP-47-ish form.
 * Deterministic: trim, `_` → `-`, lowercase language/region.
 */
export function normalizeLocaleToken(value: string): string {
  return value.trim().replace(/_/g, "-").toLowerCase();
}

export function asStringList(
  value: string | readonly string[] | undefined,
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "string" ? [value] : [...value];
}

export function firstString(
  value: string | readonly string[] | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "string" ? value : value[0];
}

/** Normalize a locale string or list of locale strings. */
export function normalizeLocaleValue(
  value: string | readonly string[],
): string | readonly string[] {
  if (typeof value === "string") {
    return normalizeLocaleToken(value);
  }
  return value.map(normalizeLocaleToken);
}
