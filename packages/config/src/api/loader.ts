import type { ConfigLoader, ConfigLoaderOptions } from "./types.js";

export interface ConfigLoaderFactory {
  createConfigLoader(options: ConfigLoaderOptions): ConfigLoader;
}

export type { ConfigLoader, ConfigLoaderOptions };
