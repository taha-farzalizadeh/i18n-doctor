import type { SupportedExtension } from "../domain/file-kinds.js";
import type {
  CompletenessMode,
  DotFilesPolicy,
  HashPolicy,
  SymlinkPolicy,
} from "../domain/plan.js";
import type { CasePolicyConfig } from "../domain/paths.js";

/** Current project model schema version. */
export const PROJECT_MODEL_VERSION = 1 as const;

/** Package/semver placeholder until release tooling owns it. */
export const SCANNER_VERSION = "0.0.0" as const;

export const DEFAULT_EXTENSIONS = [
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "vue",
  "svelte",
  "astro",
  "json",
  "yaml",
  "yml",
  "mdx",
] as const satisfies readonly SupportedExtension[];

/** Built-in directory prunes (non-exhaustive; extended by ignore defaults). */
export const DEFAULT_IGNORE_DIRECTORIES = [
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".output",
  ".turbo",
  ".cache",
] as const;

/** Dot-config files allowed when pruning dot-directories. */
export const DEFAULT_DOTFILE_ALLOWLIST = [
  ".gitignore",
  ".npmrc",
  ".editorconfig",
] as const;

export const DEFAULT_SYMLINK_POLICY: SymlinkPolicy = "within-root";
export const DEFAULT_DOT_FILES_POLICY: DotFilesPolicy = "prune-dot-dirs";
export const DEFAULT_CASE_POLICY: CasePolicyConfig = "auto";
export const DEFAULT_HASH_POLICY: HashPolicy = "on-demand";
export const DEFAULT_COMPLETENESS_MODE: CompletenessMode = "strict";
export const DEFAULT_FS_CONCURRENCY = 32;
export const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;

export const DEFAULT_BUILTIN_EXCLUDE_PATTERNS = [
  ...DEFAULT_IGNORE_DIRECTORIES.flatMap((dir) => [
    `**/${dir}`,
    `**/${dir}/**`,
  ]),
  "**/.env",
  "**/.env.*",
] as const;
