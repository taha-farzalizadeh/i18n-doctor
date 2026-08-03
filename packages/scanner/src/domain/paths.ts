/**
 * Path model: OS paths stay at the filesystem edge;
 * internal paths are POSIX and relative to the workspace root.
 */

declare const RelativePosixPathBrand: unique symbol;
declare const AbsoluteOsPathBrand: unique symbol;

/** POSIX path relative to the workspace root (no leading slash). */
export type RelativePosixPath = string & {
  readonly [RelativePosixPathBrand]: typeof RelativePosixPathBrand;
};

/** OS-specific absolute path used only at the FS syscall boundary. */
export type AbsoluteOsPath = string & {
  readonly [AbsoluteOsPathBrand]: typeof AbsoluteOsPathBrand;
};

/** Identifies the workspace root across platforms (drive letters, UNC, POSIX). */
export interface RootIdentity {
  readonly kind: "posix" | "windows-drive" | "unc";
  /** Absolute OS path of the workspace root. */
  readonly osPath: AbsoluteOsPath;
  /** Stable digest of root identity for caches. */
  readonly digest: string;
}

export type CasePolicy = "sensitive" | "insensitive";

export type CasePolicyConfig = "auto" | CasePolicy;
