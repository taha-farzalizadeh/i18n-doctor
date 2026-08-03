import type { RelativePosixPath } from "./paths.js";

export type ScannerErrorClass =
  | "PermissionDenied"
  | "NotFound"
  | "SymlinkLoop"
  | "SymlinkEscape"
  | "CaseCollision"
  | "TooLarge"
  | "BinaryContent"
  | "WorkspaceAmbiguity"
  | "InvalidRoot"
  | "Other";

export interface ScannerErrorRecord {
  readonly class: ScannerErrorClass;
  readonly message: string;
  readonly path?: RelativePosixPath;
  readonly details?: Readonly<Record<string, string>>;
}
