import path from "node:path";
import type { ProjectDetector, ProjectDetectorFactory } from "../api/detector.js";
import type {
  DetectorOptions,
  ProjectDetectionResult,
} from "../api/types.js";
import { collectContext } from "./context.js";
import { detectFrameworks } from "./detect-frameworks.js";
import { detectI18nLibraries } from "./detect-i18n.js";
import { detectLanguages } from "./detect-language.js";
import { detectPackageManagers } from "./detect-package-manager.js";
import { pickPrimary } from "./evidence.js";

const DEFAULTS = {
  minConfidence: 0.25,
  maxSourceFiles: 400,
  scanImports: true,
} as const;

class DefaultProjectDetector implements ProjectDetector {
  constructor(private readonly defaults: DetectorOptions = {}) {}

  async detect(options: DetectorOptions = {}): Promise<ProjectDetectionResult> {
    const started = performance.now();
    const root = path.resolve(
      options.root ?? this.defaults.root ?? process.cwd(),
    );
    const minConfidence =
      options.minConfidence ?? this.defaults.minConfidence ?? DEFAULTS.minConfidence;
    const maxSourceFiles =
      options.maxSourceFiles ??
      this.defaults.maxSourceFiles ??
      DEFAULTS.maxSourceFiles;
    const scanImports =
      options.scanImports ?? this.defaults.scanImports ?? DEFAULTS.scanImports;

    try {
      const ctx = await collectContext(root, { maxSourceFiles, scanImports });
      const analyzeStarted = performance.now();

      const pm = detectPackageManagers(ctx, minConfidence);
      const languages = detectLanguages(ctx, minConfidence);
      const frameworks = detectFrameworks(ctx, minConfidence);
      const i18n = detectI18nLibraries(ctx, minConfidence);

      const warnings = [...ctx.warnings];
      const unknowns = [
        ...pm.unknowns,
        ...languages.unknowns,
        ...frameworks.unknowns,
        ...i18n.unknowns,
      ];

      if (!ctx.snapshot.coverage.complete) {
        warnings.push({
          code: "incomplete-scan",
          message:
            "Project scan reported incomplete coverage; detection confidence may be reduced.",
        });
      }

      return {
        root,
        frameworks: frameworks.items,
        packageManagers: pm.items,
        languages: languages.items,
        i18nLibraries: i18n.items,
        unknowns,
        warnings,
        primary: {
          framework: pickPrimary(frameworks.items),
          packageManager: pickPrimary(pm.items),
          language: pickPrimary(languages.items),
          i18nLibrary: pickPrimary(i18n.items),
        },
        timings: {
          totalMs: performance.now() - started,
          scanMs: ctx.scanMs,
          analyzeMs: performance.now() - analyzeStarted,
        },
      };
    } catch (error) {
      // Absolute last resort — never throw to callers.
      const message = error instanceof Error ? error.message : String(error);
      return {
        root,
        frameworks: [],
        packageManagers: [],
        languages: [],
        i18nLibraries: [],
        unknowns: [
          {
            category: "other",
            message: `Detection failed unexpectedly: ${message}`,
          },
        ],
        warnings: [
          {
            code: "detector-crash",
            message: `Recovered from detector failure: ${message}`,
          },
        ],
        primary: {
          framework: undefined,
          packageManager: undefined,
          language: undefined,
          i18nLibrary: undefined,
        },
        timings: {
          totalMs: performance.now() - started,
          scanMs: 0,
          analyzeMs: 0,
        },
      };
    }
  }
}

export function createDetector(defaults?: DetectorOptions): ProjectDetector {
  return new DefaultProjectDetector(defaults);
}

export const projectDetectorFactory: ProjectDetectorFactory = {
  createDetector,
};
