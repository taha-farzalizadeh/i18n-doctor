import type { FileId, PackageId } from "./ids.js";
import type { RelativePosixPath } from "./paths.js";

export type WorkspaceManager =
  | "npm"
  | "pnpm"
  | "yarn"
  | "lerna"
  | "nx"
  | "turbo"
  | "unknown";

export type PackageKind = "singleton" | "workspace-package" | "nested";

export interface PackageUnit {
  readonly packageId: PackageId;
  readonly name: string | undefined;
  /** Package root relative to workspace root. */
  readonly root: RelativePosixPath;
  readonly kind: PackageKind;
  readonly manifestPath: RelativePosixPath | undefined;
  readonly manager: WorkspaceManager;
  readonly fileIds: readonly FileId[];
}

/**
 * Opaque layout/tooling signals. Framework identity is not asserted here.
 */
export interface ProjectSignal {
  readonly kind: string;
  readonly value: string;
  readonly path?: RelativePosixPath;
}
