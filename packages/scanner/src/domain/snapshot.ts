import type { CoverageReport } from "./coverage.js";
import type { ScannerErrorRecord } from "./errors.js";
import type { FileRole, SyntaxDomain } from "./file-kinds.js";
import type { FileId, PackageId } from "./ids.js";
import type {
  ContentHash,
  HardLinkGroup,
  HeavyFileMetadata,
  LiteFileEntry,
  PathConflict,
} from "./metadata.js";
import type { CasePolicy, RelativePosixPath, RootIdentity } from "./paths.js";
import type { PackageUnit, ProjectSignal } from "./workspace.js";

/**
 * Versioned, immutable project representation produced by the scanner.
 * projectModelVersion is additive within a major platform release.
 */
export interface ProjectSnapshot {
  readonly projectModelVersion: number;
  readonly root: RootIdentity;
  readonly scannedAt: string;
  readonly planDigest: string;
  readonly scannerVersion: string;
  readonly casePolicy: CasePolicy;
  readonly packages: readonly PackageUnit[];
  readonly coverage: CoverageReport;
  readonly errors: readonly ScannerErrorRecord[];
  readonly conflicts: readonly PathConflict[];
  readonly hardLinkGroups: readonly HardLinkGroup[];
  readonly signals: readonly ProjectSignal[];
}

/** Read model for enumerating and resolving files in a snapshot. */
export interface ProjectSnapshotView extends ProjectSnapshot {
  files(filter?: FileFilter): IterableIterator<LiteFileEntry>;
  get(fileId: FileId): LiteFileEntry | undefined;
  heavy(fileId: FileId): HeavyFileMetadata | undefined;
  lookup(path: RelativePosixPath): FileId | undefined;
  readonly content: ContentAccessor;
}

export interface FileFilter {
  readonly packageId?: PackageId;
  readonly syntaxDomain?: SyntaxDomain;
  readonly role?: FileRole;
  readonly extensions?: readonly string[];
}

export interface ContentAccessor {
  read(fileId: FileId): Promise<ContentReadResult>;
  hash(fileId: FileId): Promise<ContentHash | undefined>;
}

export type ContentReadResult =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      readonly encoding: string | undefined;
    }
  | {
      readonly ok: false;
      readonly reason: "too-large" | "binary" | "unreadable" | "missing";
      readonly message: string;
    };
