import type { AbsoluteOsPath, RelativePosixPath } from "../domain/paths.js";

/**
 * Infrastructure port for filesystem access.
 * No implementation in this skeleton.
 */
export interface FileSystemPort {
  resolveRoot(path: string | undefined): Promise<AbsoluteOsPath>;
  realpath(path: AbsoluteOsPath): Promise<AbsoluteOsPath>;
  readDir(path: AbsoluteOsPath): Promise<readonly DirEntry[]>;
  stat(path: AbsoluteOsPath): Promise<FsStat>;
  readFile(path: AbsoluteOsPath, maxBytes: number): Promise<Uint8Array>;
  exists(path: AbsoluteOsPath): Promise<boolean>;
}

export interface DirEntry {
  readonly name: string;
  readonly kind: "file" | "directory" | "symlink" | "other";
}

export interface FsStat {
  readonly kind: "file" | "directory" | "symlink" | "other";
  readonly size: number;
  readonly mtimeMs: number;
  readonly device?: string;
  readonly inode?: string;
  readonly mode?: number;
}

/**
 * Joins workspace-relative POSIX paths to OS absolute paths at the FS edge.
 */
export interface PathBridge {
  toOsPath(root: AbsoluteOsPath, relative: RelativePosixPath): AbsoluteOsPath;
  toRelativePosix(
    root: AbsoluteOsPath,
    osPath: AbsoluteOsPath,
  ): RelativePosixPath;
}
