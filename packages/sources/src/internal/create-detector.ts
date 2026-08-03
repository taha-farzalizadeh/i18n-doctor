import path from "node:path";
import { createAstEngine } from "@i18n-unused/ast";
import { createDetector } from "@i18n-unused/detect";
import {
  createScanner,
  type ProjectSnapshotView,
} from "@i18n-unused/scanner";
import type { TranslationSourceDetectorFactory } from "../api/detector.js";
import type {
  CatalogWarning,
  SourceFormat,
  SourceKind,
  SourceDetectorOptions,
  TranslationCatalog,
  TranslationSource,
  TranslationSourceDetector,
} from "../api/types.js";
import { selectCandidates, type SourceCandidate } from "./candidates.js";
import {
  buildSourceFromEntries,
  formatOfPath,
  resetSourceIds,
} from "./build-source.js";
import { extractJsonEntries } from "./extract-json.js";
import { extractJsRegions } from "./extract-js.js";
import { extractYamlEntries } from "./extract-yaml.js";

const DEFAULTS = {
  useDetection: true,
  minConfidence: 0.35,
  maxCandidates: 500,
  includeUnknownStructures: true,
} as const;

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const EXTRACT_CONCURRENCY = 6;

class DefaultSourceDetector implements TranslationSourceDetector {
  constructor(private readonly defaults: SourceDetectorOptions = {}) {}

  async discover(
    options: SourceDetectorOptions = {},
  ): Promise<TranslationCatalog> {
    const started = performance.now();
    const root = path.resolve(
      options.root ?? this.defaults.root ?? process.cwd(),
    );
    const useDetection =
      options.useDetection ??
      this.defaults.useDetection ??
      DEFAULTS.useDetection;
    const minConfidence =
      options.minConfidence ??
      this.defaults.minConfidence ??
      DEFAULTS.minConfidence;
    const maxCandidates =
      options.maxCandidates ??
      this.defaults.maxCandidates ??
      DEFAULTS.maxCandidates;
    const includeUnknownStructures =
      options.includeUnknownStructures ??
      this.defaults.includeUnknownStructures ??
      DEFAULTS.includeUnknownStructures;
    const libraryHints = new Set<string>([
      ...(this.defaults.libraryHints ?? []),
      ...(options.libraryHints ?? []),
    ]);

    const warnings: CatalogWarning[] = [];
    resetSourceIds();

    let scanMs = 0;
    let detectMs = 0;
    let extractMs = 0;

    try {
      const scanStarted = performance.now();
      const snapshot = await scanProject(root, warnings);
      scanMs = performance.now() - scanStarted;

      if (useDetection) {
        const detectStarted = performance.now();
        try {
          const detection = await createDetector().detect({
            root,
            scanImports: false,
          });
          for (const lib of detection.i18nLibraries) {
            libraryHints.add(lib.id);
          }
        } catch (error) {
          warnings.push({
            code: "detect-failed",
            message: `Framework/i18n detection failed: ${errorMessage(error)}`,
          });
        }
        detectMs = performance.now() - detectStarted;
      }

      const libraryHint = pickLibraryHint(libraryHints);
      const candidates = selectCandidates(snapshot.files(), maxCandidates);

      const extractStarted = performance.now();
      const astEngine = createAstEngine({ cache: true, concurrency: 4 });
      const sources: TranslationSource[] = [];

      await mapPool(candidates, EXTRACT_CONCURRENCY, async (candidate) => {
        const extracted = await extractCandidate({
          candidate,
          snapshot,
          libraryHint,
          minConfidence,
          includeUnknownStructures,
          astEngine,
          warnings,
        });
        for (const source of extracted) {
          sources.push(source);
        }
      });

      extractMs = performance.now() - extractStarted;

      const catalog = buildCatalog(root, sources, warnings, candidates.length, {
        totalMs: performance.now() - started,
        scanMs,
        detectMs,
        extractMs,
      });
      return appendDuplicateKeyWarnings(catalog);
    } catch (error) {
      warnings.push({
        code: "discover-failed",
        message: `Source discovery failed: ${errorMessage(error)}`,
      });
      return buildCatalog(root, [], warnings, 0, {
        totalMs: performance.now() - started,
        scanMs,
        detectMs,
        extractMs,
      });
    }
  }
}

async function extractCandidate(input: {
  candidate: SourceCandidate;
  snapshot: ProjectSnapshotView;
  libraryHint: string | undefined;
  minConfidence: number;
  includeUnknownStructures: boolean;
  astEngine: ReturnType<typeof createAstEngine>;
  warnings: CatalogWarning[];
}): Promise<TranslationSource[]> {
  const {
    candidate,
    snapshot,
    libraryHint,
    minConfidence,
    includeUnknownStructures,
    astEngine,
    warnings,
  } = input;
  const filePath = candidate.file.relativePath;
  const sources: TranslationSource[] = [];

  try {
    const read = await snapshot.content.read(candidate.file.fileId);
    if (!read.ok) {
      warnings.push({
        code: "read-failed",
        message: `Could not read ${filePath}`,
        path: filePath,
      });
      return sources;
    }
    if (read.bytes.byteLength > MAX_FILE_BYTES) {
      warnings.push({
        code: "file-too-large",
        message: `Skipping ${filePath}: exceeds ${MAX_FILE_BYTES} byte limit`,
        path: filePath,
      });
      return sources;
    }

    const text = Buffer.from(read.bytes).toString("utf8");
    const format = formatOfPath(filePath);

    if (format === "json") {
      const extracted = extractJsonEntries(text);
      if (extracted.error) {
        warnings.push({
          code: "parse-failed",
          message: extracted.error,
          path: filePath,
        });
        return sources;
      }
      if (extracted.duplicateKeys?.length) {
        warnings.push({
          code: "duplicate-keys",
          message: `Duplicate JSON keys in ${filePath}: ${extracted.duplicateKeys.slice(0, 5).join(", ")}`,
          path: filePath,
        });
      }
      if (extracted.empty) {
        warnings.push({
          code: "empty-resource",
          message: `Empty translation resource: ${filePath}`,
          path: filePath,
        });
        return sources;
      }
      const source = buildSourceFromEntries({
        filePath,
        format,
        kind: "resource-file",
        entries: extracted.entries,
        confidence: candidate.score >= 40 ? 0.55 : 0.4,
        evidence: [...candidate.reasons, "json resource"],
        ...(libraryHint ? { libraryHint } : {}),
        location: extracted.rootLocation,
        minConfidence,
      });
      if (source) {
        sources.push(source);
      }
      return sources;
    }

    if (format === "yaml") {
      const extracted = extractYamlEntries(text);
      if (extracted.error) {
        warnings.push({
          code: "parse-failed",
          message: extracted.error,
          path: filePath,
        });
        return sources;
      }
      if (extracted.entries.length === 0) {
        warnings.push({
          code: "empty-resource",
          message: `Empty translation resource: ${filePath}`,
          path: filePath,
        });
        return sources;
      }
      const source = buildSourceFromEntries({
        filePath,
        format,
        kind: "resource-file",
        entries: extracted.entries,
        confidence: candidate.score >= 40 ? 0.55 : 0.4,
        evidence: [...candidate.reasons, "yaml resource"],
        ...(libraryHint ? { libraryHint } : {}),
        location: extracted.rootLocation,
        minConfidence,
      });
      if (source) {
        sources.push(source);
      }
      return sources;
    }

    const regions = extractJsRegions(filePath, text, {
      includeUnknown: includeUnknownStructures,
      engine: astEngine,
    });
    for (const region of regions) {
      const source = buildSourceFromEntries({
        filePath,
        format,
        kind: region.kind as SourceKind,
        entries: region.entries,
        confidence: Math.max(
          region.confidence,
          candidate.score >= 40 ? 0.45 : 0.35,
        ),
        evidence: [...candidate.reasons, ...region.evidence],
        ...(region.locale ? { locale: region.locale } : {}),
        ...(region.namespace ? { namespace: region.namespace } : {}),
        ...(libraryHint ? { libraryHint } : {}),
        location: region.location,
        minConfidence,
      });
      if (source) {
        sources.push(source);
      }
    }
  } catch (error) {
    warnings.push({
      code: "extract-failed",
      message: `Extraction failed for ${filePath}: ${errorMessage(error)}`,
      path: filePath,
    });
  }
  return sources;
}

async function mapPool<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        await fn(items[index]!);
      }
    },
  );
  await Promise.all(workers);
}

async function scanProject(
  root: string,
  warnings: CatalogWarning[],
): Promise<ProjectSnapshotView> {
  try {
    const scanner = createScanner({
      config: {
        root,
        ignoreDefaults: true,
        useGitIgnore: true,
        hash: "never",
        completeness: "best-effort",
      },
    });
    const plan = await scanner.buildPlan({
      root,
      ignoreDefaults: true,
      useGitIgnore: true,
      hash: "never",
      completeness: "best-effort",
    });
    return scanner.scan(plan, { kind: "workspace" });
  } catch (error) {
    warnings.push({
      code: "scan-failed",
      message: `Project scan failed: ${errorMessage(error)}`,
      path: root,
    });
    const scanner = createScanner({
      config: {
        root,
        packages: ["."],
        ignoreDefaults: true,
        completeness: "best-effort",
      },
    });
    const plan = await scanner.buildPlan({
      root,
      packages: ["."],
      completeness: "best-effort",
    });
    return scanner.scan(plan, { kind: "workspace" });
  }
}

function buildCatalog(
  root: string,
  sources: TranslationSource[],
  warnings: CatalogWarning[],
  candidateCount: number,
  timings: TranslationCatalog["timings"],
): TranslationCatalog {
  const sorted = [...sources].sort(
    (a, b) =>
      b.confidence - a.confidence || a.filePath.localeCompare(b.filePath),
  );
  const keys = sorted.flatMap((s) => s.keys);
  const locales = unique(
    sorted.map((s) => s.locale).filter((x): x is string => !!x),
  );
  const namespaces = unique(
    sorted.map((s) => s.namespace).filter((x): x is string => !!x),
  );

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
    root,
    sources: sorted,
    keys,
    locales,
    namespaces,
    warnings,
    stats: {
      sourceCount: sorted.length,
      keyCount: keys.length,
      candidateCount,
      byFormat,
      byKind,
    },
    timings,
  };
}

function appendDuplicateKeyWarnings(
  catalog: TranslationCatalog,
): TranslationCatalog {
  const byIdentity = new Map<string, number>();
  for (const key of catalog.keys) {
    const id = `${key.locale ?? "*"}::${key.namespace ?? "*"}::${key.key}`;
    byIdentity.set(id, (byIdentity.get(id) ?? 0) + 1);
  }
  const dupes = [...byIdentity.entries()]
    .filter(([, count]) => count > 1)
    .slice(0, 20);
  if (dupes.length === 0) {
    return catalog;
  }
  return {
    ...catalog,
    warnings: [
      ...catalog.warnings,
      {
        code: "duplicate-key-definitions",
        message: `Duplicate key definitions across sources: ${dupes
          .map(([id, n]) => `${id} (×${n})`)
          .join(", ")}`,
      },
    ],
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function pickLibraryHint(hints: Set<string>): string | undefined {
  const preferred = [
    "next-intl",
    "next-i18next",
    "react-i18next",
    "i18next",
    "react-intl",
    "vue-i18n",
    "nuxt-i18n",
    "lingui",
    "ngx-translate",
    "transloco",
    "formatjs",
  ];
  for (const id of preferred) {
    if (hints.has(id)) {
      return id;
    }
  }
  return hints.values().next().value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createSourceDetector(
  defaults?: SourceDetectorOptions,
): TranslationSourceDetector {
  return new DefaultSourceDetector(defaults);
}

export const translationSourceDetectorFactory: TranslationSourceDetectorFactory =
  {
    createSourceDetector,
  };
