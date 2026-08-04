import type {
  Confidence,
  SourceFormat,
  SourceKind,
  SourceLocation,
  TranslationKeyDefinition,
  TranslationSource,
} from "../api/types.js";
import type { FlatEntry } from "./flatten.js";
import { scoreStringLeafRatio } from "./flatten.js";
import { inferLocaleFromPath } from "./locale.js";
import { inferNamespaceFromPath } from "./namespace.js";
import { buildFullKey } from "./translation-entry.js";

let sourceSeq = 0;

export function nextSourceId(filePath: string): string {
  sourceSeq += 1;
  return `src:${sourceSeq}:${filePath}`;
}

export function resetSourceIds(): void {
  sourceSeq = 0;
}

export function formatOfPath(filePath: string): SourceFormat {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".json")) {
    return "json";
  }
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    return "yaml";
  }
  if (
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".mts") ||
    lower.endsWith(".cts")
  ) {
    return "typescript";
  }
  return "javascript";
}

export function buildSourceFromEntries(input: {
  filePath: string;
  format: SourceFormat;
  kind: SourceKind;
  entries: readonly FlatEntry[];
  confidence: Confidence;
  evidence: readonly string[];
  locale?: string;
  namespace?: string;
  libraryHint?: string;
  location?: SourceLocation;
  minConfidence: number;
}): TranslationSource | undefined {
  const pathLocale = inferLocaleFromPath(input.filePath);
  const pathNamespace = inferNamespaceFromPath(input.filePath);
  const locale = input.locale ?? pathLocale;
  const namespace = input.namespace ?? pathNamespace;

  const stringRatio = scoreStringLeafRatio(input.entries);
  let confidence = input.confidence;
  if (stringRatio >= 0.9) {
    confidence = Math.min(1, confidence + 0.1);
  }
  if (pathLocale) {
    confidence = Math.min(1, confidence + 0.1);
  }
  if (input.entries.length === 0) {
    return undefined;
  }
  confidence = Math.round(Math.min(1, confidence) * 1000) / 1000;
  if (confidence < input.minConfidence) {
    return undefined;
  }

  const sourceId = nextSourceId(input.filePath);
  const keys: TranslationKeyDefinition[] = input.entries.map((entry) => ({
    key: entry.key,
    value: entry.value,
    filePath: input.filePath,
    location: entry.location,
    ...(locale ? { locale } : {}),
    ...(namespace ? { namespace } : {}),
    fullKey: buildFullKey(locale, namespace, entry.key),
    confidence,
    sourceId,
  }));

  return {
    id: sourceId,
    filePath: input.filePath,
    format: input.format,
    kind: input.kind,
    ...(locale ? { locale } : {}),
    ...(namespace ? { namespace } : {}),
    ...(input.libraryHint ? { libraryHint: input.libraryHint } : {}),
    confidence,
    keys,
    ...(input.location ? { location: input.location } : {}),
    evidence: input.evidence,
  };
}
