/** Confidence in [0, 1]. Higher means stronger evidence. */
export type Confidence = number;

export type FrameworkId =
  | "react"
  | "nextjs"
  | "react-native"
  | "expo"
  | "vue"
  | "nuxt"
  | "angular"
  | "svelte"
  | "vite"
  | "cra";

export type NextRouterKind = "app" | "pages" | "mixed" | "unknown";

export type PackageManagerId = "npm" | "pnpm" | "yarn" | "bun";

export type LanguageId = "javascript" | "typescript" | "mixed";

export type I18nLibraryId =
  | "react-i18next"
  | "i18next"
  | "next-i18next"
  | "next-intl"
  | "react-intl"
  | "formatjs"
  | "lingui"
  | "vue-i18n"
  | "nuxt-i18n"
  | "ngx-translate"
  | "transloco";

export type EvidenceKind =
  | "dependency"
  | "devDependency"
  | "peerDependency"
  | "lockfile"
  | "config-file"
  | "directory"
  | "source-import"
  | "source-pattern"
  | "tsconfig"
  | "heuristic";

export interface DetectionEvidence {
  readonly kind: EvidenceKind;
  readonly message: string;
  readonly weight: number;
  readonly path?: string;
  readonly detail?: string;
}

export interface DetectedItem<TId extends string> {
  readonly id: TId;
  readonly name: string;
  readonly confidence: Confidence;
  readonly evidence: readonly DetectionEvidence[];
}

export interface DetectedFramework extends DetectedItem<FrameworkId> {
  /** Present when id is nextjs. */
  readonly nextRouter?: NextRouterKind;
}

export type DetectedPackageManager = DetectedItem<PackageManagerId>;
export type DetectedLanguage = DetectedItem<LanguageId>;
export type DetectedI18nLibrary = DetectedItem<I18nLibraryId>;

export interface UnknownConfiguration {
  readonly category:
    | "framework"
    | "package-manager"
    | "language"
    | "i18n-library"
    | "other";
  readonly message: string;
  readonly path?: string;
  readonly detail?: string;
}

export interface DetectionWarning {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface ProjectDetectionResult {
  readonly root: string;
  readonly frameworks: readonly DetectedFramework[];
  readonly packageManagers: readonly DetectedPackageManager[];
  readonly languages: readonly DetectedLanguage[];
  readonly i18nLibraries: readonly DetectedI18nLibrary[];
  readonly unknowns: readonly UnknownConfiguration[];
  readonly warnings: readonly DetectionWarning[];
  readonly primary: {
    readonly framework: DetectedFramework | undefined;
    readonly packageManager: DetectedPackageManager | undefined;
    readonly language: DetectedLanguage | undefined;
    readonly i18nLibrary: DetectedI18nLibrary | undefined;
  };
  readonly timings: {
    readonly totalMs: number;
    readonly scanMs: number;
    readonly analyzeMs: number;
  };
}

export interface DetectorOptions {
  /** Project root. Defaults to process.cwd(). */
  readonly root?: string;
  /**
   * Minimum confidence to include an item in results.
   * @default 0.25
   */
  readonly minConfidence?: number;
  /**
   * Max source files to inspect for import signals.
   * @default 400
   */
  readonly maxSourceFiles?: number;
  /**
   * Enable AST-based import scanning.
   * @default true
   */
  readonly scanImports?: boolean;
}

export interface ProjectDetector {
  detect(options?: DetectorOptions): Promise<ProjectDetectionResult>;
}
