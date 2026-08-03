import type { AbsoluteOsPath, CasePolicy, RelativePosixPath } from "../domain/paths.js";
import {
  toOsPath as toOsPathImpl,
  toRelativePosix as toRelativePosixImpl,
} from "../domain/path-utils.js";
import type { PathBridge } from "../ports/filesystem.js";

export class DefaultPathBridge implements PathBridge {
  constructor(private readonly casePolicy: CasePolicy) {}

  toOsPath(root: AbsoluteOsPath, relative: RelativePosixPath): AbsoluteOsPath {
    return toOsPathImpl(root, relative);
  }

  toRelativePosix(
    root: AbsoluteOsPath,
    osPath: AbsoluteOsPath,
  ): RelativePosixPath {
    const rel = toRelativePosixImpl(root, osPath, this.casePolicy);
    if (rel === undefined) {
      throw new Error(`Path escapes workspace root: ${osPath}`);
    }
    return rel;
  }
}
