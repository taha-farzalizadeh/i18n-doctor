/**
 * FileSystemPort that serves buffer overlays via a sync readFile hook,
 * falling back to the real disk for everything else.
 */

import fs from "node:fs";
import path from "node:path";
import {
  createNodeFileSystem,
  type AbsoluteOsPath,
  type FileSystemPort,
  type FsStat,
} from "@i18n-doctor/scanner";

export function createOverlayFileSystemFromReadFile(
  readFileSync: (absolutePath: string) => string | undefined,
  inner: FileSystemPort = createNodeFileSystem(),
): FileSystemPort {
  const encoder = new TextEncoder();

  const overlayText = (osPath: string): string | undefined => {
    const direct = readFileSync(osPath);
    if (direct !== undefined) return direct;
    const resolved = path.resolve(osPath);
    if (resolved !== osPath) {
      const viaResolve = readFileSync(resolved);
      if (viaResolve !== undefined) return viaResolve;
    }
    try {
      const real = fs.realpathSync(osPath);
      if (real !== osPath && real !== resolved) {
        return readFileSync(real);
      }
    } catch {
      // ignore
    }
    return undefined;
  };

  return {
    resolveRoot: (rootPath) => inner.resolveRoot(rootPath),
    realpath: (osPath) => inner.realpath(osPath),
    readDir: (osPath) => inner.readDir(osPath),

    async stat(osPath: AbsoluteOsPath): Promise<FsStat> {
      const text = overlayText(osPath);
      if (text === undefined) return inner.stat(osPath);
      const size = encoder.encode(text).byteLength;
      try {
        const disk = await inner.stat(osPath);
        return { ...disk, kind: "file", size };
      } catch {
        return { kind: "file", size, mtimeMs: Date.now() };
      }
    },

    async readFile(
      osPath: AbsoluteOsPath,
      maxBytes: number,
    ): Promise<Uint8Array> {
      const text = overlayText(osPath);
      if (text === undefined) return inner.readFile(osPath, maxBytes);
      const bytes = encoder.encode(text);
      if (bytes.byteLength > maxBytes) {
        const error = new Error(
          `File exceeds maxFileBytes (${bytes.byteLength} > ${maxBytes})`,
        );
        (error as Error & { code: string }).code = "FILE_TOO_LARGE";
        throw error;
      }
      return bytes;
    },

    async exists(osPath: AbsoluteOsPath): Promise<boolean> {
      if (overlayText(osPath) !== undefined) return true;
      return inner.exists(osPath);
    },
  };
}
