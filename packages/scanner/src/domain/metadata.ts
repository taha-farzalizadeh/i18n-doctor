import type { FileId, PackageId } from "./ids.js";
import type {
  ContentState,
  FileFlag,
  FileLanguage,
  FileRole,
  SyntaxDomain,
} from "./file-kinds.js";
import type { AbsoluteOsPath, RelativePosixPath } from "./paths.js";

/** Always-present candidate file descriptor. */
export interface LiteFileEntry {
  readonly fileId: FileId;
  readonly packageId: PackageId;
  readonly relativePath: RelativePosixPath;
  readonly extension: string;
  readonly language: FileLanguage;
  readonly syntaxDomain: SyntaxDomain;
  readonly role: FileRole;
  readonly size: number;
  readonly mtimeMs: number;
  readonly flags: readonly FileFlag[];
  readonly contentState: ContentState;
}

/** On-demand / heavy metadata. */
export interface HeavyFileMetadata {
  readonly fileId: FileId;
  readonly realpath: AbsoluteOsPath | undefined;
  readonly device: string | undefined;
  readonly inode: string | undefined;
  readonly locatorPaths: readonly RelativePosixPath[];
  readonly contentHash: ContentHash | undefined;
  readonly encoding: string | undefined;
  readonly statError: string | undefined;
}

export interface ContentHash {
  readonly algorithm: "sha256";
  readonly digest: string;
}

export interface HardLinkGroup {
  readonly device: string;
  readonly inode: string;
  readonly fileIds: readonly FileId[];
}

export interface PathConflict {
  readonly kind: "case-collision" | "duplicate-locator";
  readonly paths: readonly RelativePosixPath[];
  readonly canonicalFileId: FileId;
  readonly message: string;
}
