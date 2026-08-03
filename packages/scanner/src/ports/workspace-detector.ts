import type { AbsoluteOsPath, RelativePosixPath } from "../domain/paths.js";
import type { WorkspaceManager } from "../domain/workspace.js";

export interface DetectedWorkspace {
  readonly packageRoots: readonly RelativePosixPath[];
  readonly manager: WorkspaceManager;
  readonly ambiguity?: {
    readonly chosen: WorkspaceManager;
    readonly discarded: readonly WorkspaceManager[];
  };
}

/**
 * Deterministic workspace/package root detection.
 * Explicit config packages short-circuit this port.
 */
export interface WorkspaceDetectorPort {
  detect(root: AbsoluteOsPath): Promise<DetectedWorkspace>;
}
