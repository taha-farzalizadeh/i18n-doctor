import type { PackageId } from "./ids.js";
import type { RelativePosixPath } from "./paths.js";

/**
 * Default for large / monorepo projects is package-scoped scan,
 * not whole-repo flatten.
 */
export type ScanScope =
  | { readonly kind: "workspace" }
  | { readonly kind: "packages"; readonly packageIds: readonly PackageId[] }
  | { readonly kind: "paths"; readonly paths: readonly RelativePosixPath[] };
