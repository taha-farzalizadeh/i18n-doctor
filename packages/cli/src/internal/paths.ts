/**
 * Cross-platform path helpers for CLI reports and discovery.
 * Relative report paths are always POSIX (`/`) for stable, portable output.
 */

import path from "node:path";

/** Normalize to an absolute path for the current platform. */
export function normalizeAbsolute(filePath: string): string {
  return path.normalize(path.resolve(filePath));
}

/** Convert any OS path separators to POSIX `/` for reporters. */
export function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

/** Case-aware equality for paths (Windows is case-insensitive). */
export function pathsEqual(a: string, b: string): boolean {
  const left = path.normalize(a);
  const right = path.normalize(b);
  if (process.platform === "win32") {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}

/** Relative path from root, POSIX-normalized. */
export function relativePosix(root: string, absolutePath: string): string {
  return toPosixPath(path.relative(root, absolutePath));
}
