import type { IgnoreExplanation, IgnoreRule } from "../domain/ignore.js";
import type { RelativePosixPath } from "../domain/paths.js";

/**
 * gitignore-compatible ignore engine port.
 * Must support directory pruning during walk when implemented.
 */
export interface IgnoreEnginePort {
  isIgnored(
    path: RelativePosixPath,
    isDirectory: boolean,
  ): boolean;
  explain(path: RelativePosixPath): IgnoreExplanation;
  readonly rules: readonly IgnoreRule[];
}

export interface IgnoreEngineFactory {
  create(rules: readonly IgnoreRule[]): IgnoreEnginePort;
}
