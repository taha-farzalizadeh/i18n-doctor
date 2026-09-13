/**
 * Incrementally re-extract known JSON/YAML resource files into an existing
 * catalog. Avoids a full project scan when the editor only edits locale files.
 */

import path from "node:path";
import type {
  CatalogWarning,
  SourceFormat,
  SourceKind,
  TranslationCatalog,
  TranslationSource,
} from "../api/types.js";
import { buildSourceFromEntries } from "./build-source.js";
import { extractJsonEntries } from "./extract-json.js";
import { extractYamlEntries } from "./extract-yaml.js";

export interface RefreshResourceFilesInput {
  readonly catalog: TranslationCatalog;
  /** Absolute paths of edited/deleted resource files. */
  readonly absolutePaths: readonly string[];
  readonly readFile: (absolutePath: string) => string | undefined;
  readonly minConfidence?: number;
}

/**
 * Patch `catalog` for the given resource files.
 * Returns `undefined` when a path is not a known JSON/YAML resource in the
 * catalog (caller should fall back to full discovery).
 */
export function refreshResourceFilesInCatalog(
  input: RefreshResourceFilesInput,
): TranslationCatalog | undefined {
  const { catalog, absolutePaths, readFile } = input;
  const minConfidence = input.minConfidence ?? 0.35;
  if (absolutePaths.length === 0) return catalog;

  const root = catalog.root;
  // Map each pending editor path → canonical catalog absolute path.
  const touchedCanonical = new Map<string, string>();
  for (const raw of absolutePaths) {
    const absolute = normalizePath(path.resolve(raw));
    const existing = sourcesForAbsolute(catalog, absolute);
    if (existing.length === 0) {
      const ext = path.extname(absolute).toLowerCase();
      if (ext !== ".json" && ext !== ".yaml" && ext !== ".yml") {
        return undefined;
      }
      // Brand-new locale file — need full discovery for registrations/locale.
      return undefined;
    }
    if (existing.some((s) => s.format !== "json" && s.format !== "yaml")) {
      return undefined;
    }
    const canonical = absoluteOf(root, existing[0]!.filePath);
    touchedCanonical.set(canonical, absolute);
  }

  const keep: TranslationSource[] = [];
  for (const source of catalog.sources) {
    const abs = absoluteOf(root, source.filePath);
    const isTouched = [...touchedCanonical.keys()].some((key) =>
      samePath(key, abs),
    );
    if (!isTouched) {
      keep.push(source);
    }
  }

  const warnings: CatalogWarning[] = [...catalog.warnings];

  for (const [canonical, readAs] of touchedCanonical) {
    const previous = sourcesForAbsolute(catalog, canonical)[0];
    if (!previous) continue;
    const absolute = readAs;

    const text = readFile(absolute);
    if (text === undefined) {
      // File deleted — drop its sources (already omitted from keep).
      continue;
    }

    const relative = toPosix(
      path.isAbsolute(previous.filePath)
        ? path.relative(root, previous.filePath)
        : previous.filePath,
    );
    const refreshed = extractResourceSource({
      relativePath: relative,
      text,
      format: previous.format,
      kind: previous.kind,
      minConfidence,
      previous,
      warnings,
    });
    if (refreshed) {
      keep.push(refreshed);
    }
  }

  return rebuildCatalog(catalog, keep, warnings);
}

function extractResourceSource(input: {
  relativePath: string;
  text: string;
  format: SourceFormat;
  kind: SourceKind;
  minConfidence: number;
  previous: TranslationSource;
  warnings: CatalogWarning[];
}): TranslationSource | undefined {
  const { relativePath, text, format, kind, minConfidence, previous, warnings } =
    input;

  if (format === "json") {
    const extracted = extractJsonEntries(text);
    if (extracted.error) {
      warnings.push({
        code: "parse-failed",
        message: extracted.error,
        path: relativePath,
      });
      return undefined;
    }
    if (extracted.empty || extracted.entries.length === 0) {
      return undefined;
    }
    return buildSourceFromEntries({
      filePath: relativePath,
      format,
      kind,
      entries: extracted.entries,
      confidence: previous.confidence,
      evidence: previous.evidence,
      ...(previous.locale ? { locale: previous.locale } : {}),
      ...(previous.namespace ? { namespace: previous.namespace } : {}),
      ...(previous.libraryHint ? { libraryHint: previous.libraryHint } : {}),
      ...(extracted.rootLocation ? { location: extracted.rootLocation } : {}),
      minConfidence,
    });
  }

  if (format === "yaml") {
    const extracted = extractYamlEntries(text);
    if (extracted.error) {
      warnings.push({
        code: "parse-failed",
        message: extracted.error,
        path: relativePath,
      });
      return undefined;
    }
    if (extracted.entries.length === 0) {
      return undefined;
    }
    return buildSourceFromEntries({
      filePath: relativePath,
      format,
      kind,
      entries: extracted.entries,
      confidence: previous.confidence,
      evidence: previous.evidence,
      ...(previous.locale ? { locale: previous.locale } : {}),
      ...(previous.namespace ? { namespace: previous.namespace } : {}),
      ...(previous.libraryHint ? { libraryHint: previous.libraryHint } : {}),
      minConfidence,
    });
  }

  return undefined;
}

function sourcesForAbsolute(
  catalog: TranslationCatalog,
  absolute: string,
): TranslationSource[] {
  const target = normalizePath(absolute);
  return catalog.sources.filter((s) =>
    samePath(absoluteOf(catalog.root, s.filePath), target),
  );
}

function absoluteOf(root: string, filePath: string): string {
  return normalizePath(
    path.isAbsolute(filePath) ? filePath : path.join(root, filePath),
  );
}

function normalizePath(p: string): string {
  return path.resolve(p).replace(/\\/g, "/");
}

/** macOS often mixes `/var/...` with realpath `/private/var/...`. */
function samePath(a: string, b: string): boolean {
  if (a === b) return true;
  const stripPrivate = (value: string): string =>
    value.replace(/^\/private(\/|$)/, "/");
  return stripPrivate(a).toLowerCase() === stripPrivate(b).toLowerCase();
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

function rebuildCatalog(
  previous: TranslationCatalog,
  sources: readonly TranslationSource[],
  warnings: readonly CatalogWarning[],
): TranslationCatalog {
  const sorted = [...sources].sort(
    (a, b) =>
      b.confidence - a.confidence || a.filePath.localeCompare(b.filePath),
  );
  const keys = sorted.flatMap((s) => s.keys);
  const locales = unique(
    sorted.map((s) => s.locale).filter((x): x is string => !!x),
  );
  const namespaces = unique([
    ...sorted.map((s) => s.namespace).filter((x): x is string => !!x),
    ...sorted.flatMap((s) => s.namespaces ?? []),
  ]);

  const byFormat: Record<SourceFormat, number> = {
    json: 0,
    yaml: 0,
    javascript: 0,
    typescript: 0,
  };
  const byKind: Partial<Record<SourceKind, number>> = {};
  for (const source of sorted) {
    byFormat[source.format] += 1;
    byKind[source.kind] = (byKind[source.kind] ?? 0) + 1;
  }

  return {
    root: previous.root,
    sources: sorted,
    keys,
    locales,
    namespaces,
    warnings,
    stats: {
      sourceCount: sorted.length,
      keyCount: keys.length,
      candidateCount: previous.stats.candidateCount,
      byFormat,
      byKind,
    },
    timings: {
      ...previous.timings,
      extractMs: previous.timings.extractMs,
      totalMs: previous.timings.totalMs,
    },
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}
