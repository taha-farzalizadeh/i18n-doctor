import type { ImportResolver, ImportResolverOptions } from "./types.js";

export interface ImportResolverFactory {
  createImportResolver(options: ImportResolverOptions): ImportResolver;
}

export type { ImportResolver, ImportResolverOptions };
