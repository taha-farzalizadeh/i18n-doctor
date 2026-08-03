import path from "node:path";
import { createDetector } from "@i18n-unused/detect";
import {
  createScanner,
  type ProjectSnapshotView,
} from "@i18n-unused/scanner";
import type { UsageDetectorFactory } from "../api/detector.js";
import type {
  UsageCatalog,
  UsageContext,
  UsageDetector,
  UsageDetectorOptions,
  UsageLibraryId,
  UsageWarning,
} from "../api/types.js";
import { collectUsages } from "./collect.js";

const DEFAULTS = {
  useDetection: true,
  minConfidence: 0.4,
  maxFiles: 2000,
  scanTemplates: true,
} as const;

class DefaultUsageDetector implements UsageDetector {
  constructor(private readonly defaults: UsageDetectorOptions = {}) {}

  async detect(options: UsageDetectorOptions = {}): Promise<UsageCatalog> {
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
    const maxFiles =
      options.maxFiles ?? this.defaults.maxFiles ?? DEFAULTS.maxFiles;
    const scanTemplates =
      options.scanTemplates ??
      this.defaults.scanTemplates ??
      DEFAULTS.scanTemplates;

    const libraryHints = new Set<string>([
      ...(this.defaults.libraryHints ?? []),
      ...(options.libraryHints ?? []),
    ]);
    const warnings: UsageWarning[] = [];

    let scanMs = 0;
    let detectMs = 0;
    let analyzeMs = 0;

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
            message: `Detection failed: ${errorMessage(error)}`,
          });
        }
        detectMs = performance.now() - detectStarted;
      }

      const analyzeStarted = performance.now();
      const { usages, fileCount } = await collectUsages({
        root,
        snapshot,
        libraryHints,
        minConfidence,
        maxFiles,
        scanTemplates,
        warnings,
      });
      analyzeMs = performance.now() - analyzeStarted;

      const sorted = [...usages].sort(
        (a, b) =>
          a.relativePath.localeCompare(b.relativePath) ||
          a.location.line - b.location.line ||
          a.location.column - b.location.column ||
          a.key.localeCompare(b.key),
      );

      return buildCatalog(root, sorted, warnings, fileCount, {
        totalMs: performance.now() - started,
        scanMs,
        detectMs,
        analyzeMs,
      });
    } catch (error) {
      warnings.push({
        code: "usage-detect-failed",
        message: `Usage detection failed: ${errorMessage(error)}`,
      });
      return buildCatalog(root, [], warnings, 0, {
        totalMs: performance.now() - started,
        scanMs,
        detectMs,
        analyzeMs,
      });
    }
  }
}

/** Include HTML templates for Angular pipe detection (not in scanner defaults). */
const USAGE_EXTENSIONS = [
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "mts",
  "cts",
  "vue",
  "html",
  "htm",
  "svelte",
  "astro",
] as const;

async function scanProject(
  root: string,
  warnings: UsageWarning[],
): Promise<ProjectSnapshotView> {
  try {
    const scanner = createScanner({
      config: {
        root,
        ignoreDefaults: true,
        useGitIgnore: true,
        hash: "never",
        completeness: "best-effort",
        extensions: [...USAGE_EXTENSIONS],
      },
    });
    const plan = await scanner.buildPlan({
      root,
      ignoreDefaults: true,
      useGitIgnore: true,
      hash: "never",
      completeness: "best-effort",
      extensions: [...USAGE_EXTENSIONS],
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
        extensions: [...USAGE_EXTENSIONS],
      },
    });
    const plan = await scanner.buildPlan({
      root,
      packages: ["."],
      completeness: "best-effort",
      extensions: [...USAGE_EXTENSIONS],
    });
    return scanner.scan(plan, { kind: "workspace" });
  }
}

function buildCatalog(
  root: string,
  usages: UsageCatalog["usages"][number][],
  warnings: UsageWarning[],
  fileCount: number,
  timings: UsageCatalog["timings"],
): UsageCatalog {
  const byLibrary: Partial<Record<UsageLibraryId, number>> = {};
  const byContext: Partial<Record<UsageContext, number>> = {};
  const libraries = new Set<UsageLibraryId>();

  for (const usage of usages) {
    byLibrary[usage.library] = (byLibrary[usage.library] ?? 0) + 1;
    byContext[usage.context] = (byContext[usage.context] ?? 0) + 1;
    libraries.add(usage.library);
  }

  return {
    root,
    usages,
    libraries: [...libraries].sort(),
    warnings,
    stats: {
      fileCount,
      usageCount: usages.length,
      byLibrary,
      byContext,
    },
    timings,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createUsageDetector(
  defaults?: UsageDetectorOptions,
): UsageDetector {
  return new DefaultUsageDetector(defaults);
}

export const usageDetectorFactory: UsageDetectorFactory = {
  createUsageDetector,
};
