import type { RelativePosixPath } from "./paths.js";

export type ChangeKind = "created" | "deleted" | "modified" | "directory-invalidated";

export interface PathChange {
  readonly kind: ChangeKind;
  readonly path: RelativePosixPath;
}

/** Input to incremental rescan. */
export interface ChangeSet {
  readonly changes: readonly PathChange[];
}
