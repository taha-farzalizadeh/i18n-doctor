import type { CasePolicyConfig } from "../domain/paths.js";
import type {
  CompletenessMode,
  DotFilesPolicy,
  HashPolicy,
  SymlinkPolicy,
} from "../domain/plan.js";
import {
  DEFAULT_CASE_POLICY,
  DEFAULT_COMPLETENESS_MODE,
  DEFAULT_DOT_FILES_POLICY,
  DEFAULT_EXTENSIONS,
  DEFAULT_FS_CONCURRENCY,
  DEFAULT_HASH_POLICY,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_SYMLINK_POLICY,
} from "./defaults.js";

/**
 * Minimal public scanner configuration.
 * Plugin options stay namespaced elsewhere; scanner only sees merged plan fragments.
 */
export interface ScannerConfig {
  /** Workspace root; implementation may default to process cwd. */
  readonly root?: string;
  /** Explicit package roots/globs; short-circuits workspace detection when set. */
  readonly packages?: readonly string[];
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly extensions?: readonly string[];
  readonly symlink?: SymlinkPolicy;
  readonly dotFiles?: DotFilesPolicy;
  readonly casePolicy?: CasePolicyConfig;
  readonly fsConcurrency?: number;
  readonly maxFileBytes?: number;
  readonly hash?: HashPolicy;
  readonly ignoreDefaults?: boolean;
  readonly useGitIgnore?: boolean;
  readonly completeness?: CompletenessMode;
  readonly cacheDir?: string;
}

/** Resolved config with defaults applied (still no IO). */
export interface ResolvedScannerConfig {
  readonly root: string | undefined;
  readonly packages: readonly string[] | undefined;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly extensions: readonly string[];
  readonly symlink: SymlinkPolicy;
  readonly dotFiles: DotFilesPolicy;
  readonly casePolicy: CasePolicyConfig;
  readonly fsConcurrency: number;
  readonly maxFileBytes: number;
  readonly hash: HashPolicy;
  readonly ignoreDefaults: boolean;
  readonly useGitIgnore: boolean;
  readonly completeness: CompletenessMode;
  readonly cacheDir: string | undefined;
}

export const DEFAULT_SCANNER_CONFIG: ResolvedScannerConfig = {
  root: undefined,
  packages: undefined,
  include: ["**/*"],
  exclude: [],
  extensions: [...DEFAULT_EXTENSIONS],
  symlink: DEFAULT_SYMLINK_POLICY,
  dotFiles: DEFAULT_DOT_FILES_POLICY,
  casePolicy: DEFAULT_CASE_POLICY,
  fsConcurrency: DEFAULT_FS_CONCURRENCY,
  maxFileBytes: DEFAULT_MAX_FILE_BYTES,
  hash: DEFAULT_HASH_POLICY,
  ignoreDefaults: true,
  useGitIgnore: true,
  completeness: DEFAULT_COMPLETENESS_MODE,
  cacheDir: undefined,
};

/**
 * Pure merge of user config onto defaults. No filesystem access.
 */
export function resolveScannerConfig(
  config: ScannerConfig = {},
): ResolvedScannerConfig {
  return {
    root: config.root ?? DEFAULT_SCANNER_CONFIG.root,
    packages: config.packages ?? DEFAULT_SCANNER_CONFIG.packages,
    include: config.include ?? DEFAULT_SCANNER_CONFIG.include,
    exclude: config.exclude ?? DEFAULT_SCANNER_CONFIG.exclude,
    extensions: config.extensions ?? DEFAULT_SCANNER_CONFIG.extensions,
    symlink: config.symlink ?? DEFAULT_SCANNER_CONFIG.symlink,
    dotFiles: config.dotFiles ?? DEFAULT_SCANNER_CONFIG.dotFiles,
    casePolicy: config.casePolicy ?? DEFAULT_SCANNER_CONFIG.casePolicy,
    fsConcurrency: config.fsConcurrency ?? DEFAULT_SCANNER_CONFIG.fsConcurrency,
    maxFileBytes: config.maxFileBytes ?? DEFAULT_SCANNER_CONFIG.maxFileBytes,
    hash: config.hash ?? DEFAULT_SCANNER_CONFIG.hash,
    ignoreDefaults:
      config.ignoreDefaults ?? DEFAULT_SCANNER_CONFIG.ignoreDefaults,
    useGitIgnore: config.useGitIgnore ?? DEFAULT_SCANNER_CONFIG.useGitIgnore,
    completeness: config.completeness ?? DEFAULT_SCANNER_CONFIG.completeness,
    cacheDir: config.cacheDir ?? DEFAULT_SCANNER_CONFIG.cacheDir,
  };
}
