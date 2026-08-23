import type { FileSystemPort } from "../ports/filesystem.js";
import type { ScannerConfig } from "./scanner-config.js";

/** Options for constructing a Scanner instance. */
export interface CreateScannerOptions {
  readonly config?: ScannerConfig;
  /** Override default FS concurrency independently of config merge if needed. */
  readonly fsConcurrency?: number;
  readonly maxFileBytes?: number;
  readonly cacheDir?: string;
  /**
   * Filesystem implementation. Defaults to the Node filesystem.
   *
   * Supplying a port lets long-lived hosts (editors, language servers) serve
   * unsaved buffer contents without changing scan semantics.
   */
  readonly fs?: FileSystemPort;
}
