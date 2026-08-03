import type { FileId, PackageId } from "./ids.js";
import type { AbsoluteOsPath, RelativePosixPath } from "./paths.js";

export function asFileId(value: string): FileId {
  return value as FileId;
}

export function asPackageId(value: string): PackageId {
  return value as PackageId;
}

export function asRelativePosixPath(value: string): RelativePosixPath {
  return value as RelativePosixPath;
}

export function asAbsoluteOsPath(value: string): AbsoluteOsPath {
  return value as AbsoluteOsPath;
}
