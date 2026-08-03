import type { LocalResolver, LocalResolverOptions } from "./types.js";

export interface LocalResolverFactory {
  createLocalResolver(options?: LocalResolverOptions): LocalResolver;
}

export type { LocalResolver, LocalResolverOptions };
