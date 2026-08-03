import type { ScannerConfig } from "./scanner-config.js";

/** Options for constructing a Scanner instance. */
export interface CreateScannerOptions {
  readonly config?: ScannerConfig;
  /** Override default FS concurrency independently of config merge if needed. */
  readonly fsConcurrency?: number;
  readonly maxFileBytes?: number;
  readonly cacheDir?: string;
}
