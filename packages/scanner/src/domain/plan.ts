import type { SupportedExtension } from "./file-kinds.js";
import type { IgnoreRule } from "./ignore.js";
import type { CasePolicy, RelativePosixPath, RootIdentity } from "./paths.js";

export type SymlinkPolicy = "never" | "within-root" | "follow-once";

export type DotFilesPolicy = "prune-dot-dirs" | "include-all" | "custom";

export type HashPolicy = "never" | "on-demand" | "always";

export type CompletenessMode = "strict" | "best-effort";

/**
 * Fragment contributed by plugins before scan.
 * Plugins never walk the filesystem themselves.
 */
export interface DiscoverContribution {
  readonly pluginId: string;
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly extensions?: readonly string[];
  readonly resourceRoots?: readonly RelativePosixPath[];
  readonly signals?: readonly string[];
}

/**
 * Frozen discovery plan. Scan/rescan are deterministic relative to FS state
 * once this object exists.
 */
export interface DiscoveryPlan {
  readonly planDigest: string;
  readonly root: RootIdentity;
  readonly packageRoots: readonly RelativePosixPath[];
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly extensions: readonly SupportedExtension[] | readonly string[];
  readonly ignoreRules: readonly IgnoreRule[];
  readonly symlink: SymlinkPolicy;
  readonly dotFiles: DotFilesPolicy;
  readonly casePolicy: CasePolicy;
  readonly fsConcurrency: number;
  readonly maxFileBytes: number;
  readonly hash: HashPolicy;
  readonly completeness: CompletenessMode;
  readonly contributions: readonly DiscoverContribution[];
}
