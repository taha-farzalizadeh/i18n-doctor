import type { RelativePosixPath } from "./paths.js";

/** Effective ignore rule after plan composition. */
export interface IgnoreRule {
  readonly pattern: string;
  readonly source:
    | "builtin"
    | "gitignore"
    | "config-exclude"
    | "config-include"
    | "plugin";
  readonly negated: boolean;
}

export interface IgnoreExplanation {
  readonly path: RelativePosixPath;
  readonly ignored: boolean;
  readonly matchedRule: IgnoreRule | undefined;
  readonly layers: readonly IgnoreRule[];
}
