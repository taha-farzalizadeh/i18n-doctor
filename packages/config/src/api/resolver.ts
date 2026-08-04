import type {
  EffectiveConfigResolver,
  IgnoreEngine,
  SuppressionEngine,
  UserConfig,
} from "./types.js";

export interface EffectiveConfigResolverFactory {
  createEffectiveConfigResolver(): EffectiveConfigResolver;
}

export interface IgnoreEngineFactory {
  createIgnoreEngine(config: {
    readonly ignoreKeys?: readonly string[];
    readonly ignoreFiles?: readonly string[];
    readonly ignoreLocales?: readonly string[];
    readonly ignoreNamespaces?: readonly string[];
    readonly include?: readonly string[];
    readonly exclude?: readonly string[];
  }): IgnoreEngine;
}

export interface SuppressionEngineFactory {
  createSuppressionEngine(): SuppressionEngine;
}

export type {
  EffectiveConfigResolver,
  IgnoreEngine,
  SuppressionEngine,
  UserConfig,
};
