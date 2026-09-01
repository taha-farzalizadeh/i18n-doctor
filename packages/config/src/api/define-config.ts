/**
 * Public config conveniences:
 * - {@link defineConfig}: typed helper for `i18n-doctor.config.ts`.
 * - {@link loadConfig}: find + load + validate + normalize for one root.
 *
 * Both are thin layers over the shared loader/resolver — no parsing or
 * matching logic lives here.
 */

import type {
  ConfigDiagnostic,
  EffectiveConfig,
  UserConfig,
} from "./types.js";
import path from "node:path";
import { createConfigLoader } from "../internal/create-loader.js";
import { createEffectiveConfigResolver } from "../internal/create-resolver.js";
import { DEFAULT_USER_CONFIG } from "../internal/defaults.js";

/**
 * Typed helper for `i18n-doctor.config.ts` / `.js` / `.mjs`.
 *
 * Identity at runtime — config files are parsed statically (never executed),
 * so this only exists to give users type checking and editor completions.
 * More options may be added to {@link UserConfig} without breaking this API.
 *
 * @example
 * import { defineConfig } from "i18n-doctor";
 *
 * export default defineConfig({
 *   ignoreKeys: ["SERVER_*", "BACKEND_*"],
 * });
 */
export function defineConfig(config: UserConfig): UserConfig {
  return config;
}

/** Options for {@link loadConfig}. */
export interface LoadConfigOptions {
  /** Project / workspace root to search for a config file. Required. */
  readonly cwd: string;
  /** Explicit config path (absolute or cwd-relative) — skips auto-discovery. */
  readonly configPath?: string;
  readonly fileExists?: (absolutePath: string) => boolean;
  readonly readFile?: (absolutePath: string) => string | undefined;
}

/** Result of {@link loadConfig}. */
export interface LoadConfigResult {
  /** The cwd the config was resolved from (echoed back). */
  readonly cwd: string;
  /** Absolute path of the config file, when one was found. */
  readonly configPath?: string;
  /**
   * Normalized user config. When no config file exists this is the default
   * configuration (`ignoreKeys: []`, …) — absence never breaks consumers.
   */
  readonly config: UserConfig;
  /** Validation diagnostics (parse errors, unknown keys, invalid types). */
  readonly diagnostics: readonly ConfigDiagnostic[];
}

/**
 * Find, load, validate, and normalize the nearest i18n-doctor config for a
 * project/workspace root. Shared by the CLI, the ESLint plugin, and the
 * language server — each passes its own root; `process.cwd()` is never
 * assumed here.
 *
 * @param options.cwd — project/workspace root (required)
 * @param options.configPath — explicit config path, skips auto-discovery
 */
export async function loadConfig(
  options: LoadConfigOptions,
): Promise<LoadConfigResult> {
  if (!options?.cwd) {
    throw new TypeError(
      "loadConfig requires an explicit `cwd` (project/workspace root)",
    );
  }

  const resolver = createEffectiveConfigResolver();
  const loader = createConfigLoader({
    root: options.cwd,
    ...(options.configPath !== undefined
      ? { configPath: options.configPath }
      : {}),
    ...(options.fileExists !== undefined
      ? { fileExists: options.fileExists }
      : {}),
    ...(options.readFile !== undefined
      ? { readFile: options.readFile }
      : {}),
  });
  const loaded = loader.load();
  const effective: EffectiveConfig = resolver.resolve({
    root: options.cwd,
    loaded,
  });

  const config: UserConfig = {
    ignoreKeys: effective.ignoreKeys ?? [...DEFAULT_USER_CONFIG.ignoreKeys],
    ignoreFiles: effective.ignoreFiles,
    ignoreLocales: effective.ignoreLocales,
    ignoreNamespaces: effective.ignoreNamespaces,
    include: effective.include,
    exclude: effective.exclude,
    rules: { ...effective.rules.severities },
    exitOnError: effective.exit.exitOnError,
    failOnWarning: effective.exit.failOnWarning,
    minConfidence: effective.minConfidence,
    output: { ...effective.output },
    ...(effective.packages !== undefined
      ? { packages: effective.packages }
      : {}),
    languageServer: { ...effective.languageServer },
  };

  // The loader reports the config path relative to root; expose absolute.
  const configPath = loaded.configPath
    ? path.resolve(options.cwd, loaded.configPath)
    : undefined;

  return {
    cwd: options.cwd,
    ...(configPath !== undefined ? { configPath } : {}),
    config,
    diagnostics: effective.diagnostics,
  };
}
