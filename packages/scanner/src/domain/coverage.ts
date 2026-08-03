import type { PackageId } from "./ids.js";
import type { RelativePosixPath } from "./paths.js";
import type { ScannerErrorClass } from "./errors.js";

/**
 * Completeness is first-class: unreadable trees are never treated as empty success.
 */
export interface CoverageReport {
  readonly complete: boolean;
  readonly packagesScanned: readonly PackageId[];
  readonly packagesSkipped: readonly PackageId[];
  readonly filesCandidateCount: number;
  readonly errorsByClass: Readonly<Partial<Record<ScannerErrorClass, number>>>;
  readonly unreadableRoots: readonly RelativePosixPath[];
  readonly zeroCandidates: boolean;
  readonly symlinkEscapesBlocked: number;
}
