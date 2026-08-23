import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { asAbsoluteOsPath } from "../domain/brands.js";
import type { AbsoluteOsPath } from "../domain/paths.js";
import { normalizeOsPath } from "../domain/path-utils.js";
import { errorMessage, isErrno, ScannerOperationError } from "../application/errors.js";
import type { DirEntry, FileSystemPort, FsStat } from "../ports/filesystem.js";

export class NodeFileSystem implements FileSystemPort {
  async resolveRoot(rootPath: string | undefined): Promise<AbsoluteOsPath> {
    const candidate = rootPath === undefined || rootPath.length === 0
      ? process.cwd()
      : rootPath;

    try {
      const abs = normalizeOsPath(path.resolve(candidate));
      const st = await fs.stat(abs);
      if (!st.isDirectory()) {
        throw new ScannerOperationError(
          `Scanner root is not a directory: ${abs}`,
          "InvalidRoot",
          { path: abs },
        );
      }
      // Canonicalize so macOS /var vs /private/var (and similar) match symlink realpaths.
      const real = normalizeOsPath(await fs.realpath(abs));
      return asAbsoluteOsPath(real);
    } catch (error) {
      if (error instanceof ScannerOperationError) {
        throw error;
      }
      if (isErrno(error, "ENOENT")) {
        throw new ScannerOperationError(
          `Scanner root does not exist: ${candidate}`,
          "InvalidRoot",
          { path: String(candidate) },
        );
      }
      if (isErrno(error, "EACCES") || isErrno(error, "EPERM")) {
        throw new ScannerOperationError(
          `Permission denied reading scanner root: ${candidate}`,
          "PermissionDenied",
          { path: String(candidate) },
        );
      }
      throw new ScannerOperationError(
        `Unable to resolve scanner root '${candidate}': ${errorMessage(error)}`,
        "InvalidRoot",
        { path: String(candidate) },
      );
    }
  }

  async realpath(osPath: AbsoluteOsPath): Promise<AbsoluteOsPath> {
    const resolved = await fs.realpath(osPath);
    return asAbsoluteOsPath(normalizeOsPath(resolved));
  }

  async readDir(osPath: AbsoluteOsPath): Promise<readonly DirEntry[]> {
    const entries = await fs.readdir(osPath, { withFileTypes: true });
    return entries.map((entry) => {
      let kind: DirEntry["kind"] = "other";
      if (entry.isSymbolicLink()) {
        kind = "symlink";
      } else if (entry.isDirectory()) {
        kind = "directory";
      } else if (entry.isFile()) {
        kind = "file";
      }
      return { name: entry.name, kind };
    });
  }

  async stat(osPath: AbsoluteOsPath): Promise<FsStat> {
    const st = await fs.lstat(osPath);
    let kind: FsStat["kind"] = "other";
    if (st.isSymbolicLink()) {
      kind = "symlink";
    } else if (st.isDirectory()) {
      kind = "directory";
    } else if (st.isFile()) {
      kind = "file";
    }
    return {
      kind,
      size: st.size,
      mtimeMs: st.mtimeMs,
      device: String(st.dev),
      inode: String(st.ino),
      mode: st.mode,
    };
  }

  async readFile(osPath: AbsoluteOsPath, maxBytes: number): Promise<Uint8Array> {
    const handle = await fs.open(osPath, "r");
    try {
      const st = await handle.stat();
      if (st.size > maxBytes) {
        const err = new Error(`File exceeds maxFileBytes (${st.size} > ${maxBytes})`);
        (err as Error & { code: string }).code = "FILE_TOO_LARGE";
        throw err;
      }
      const buffer = Buffer.allocUnsafe(st.size);
      const { bytesRead } = await handle.read(buffer, 0, st.size, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  async exists(osPath: AbsoluteOsPath): Promise<boolean> {
    try {
      await fs.access(osPath);
      return true;
    } catch {
      return false;
    }
  }
}

/** Node-backed {@link FileSystemPort} — the scanner default. */
export function createNodeFileSystem(): FileSystemPort {
  return new NodeFileSystem();
}

export async function readTextFile(
  fsPort: FileSystemPort,
  osPath: AbsoluteOsPath,
  maxBytes: number,
): Promise<string | undefined> {
  try {
    const bytes = await fsPort.readFile(osPath, maxBytes);
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return undefined;
  }
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  for (let i = 0; i < sample.length; i += 1) {
    if (sample[i] === 0) {
      return true;
    }
  }
  return false;
}
