/**
 * Reads the `i18nDoctor.*` VS Code settings and maps them onto the language
 * server's existing `languageServer` configuration block.
 *
 * Only values the user explicitly set are forwarded. Defaults contributed in
 * package.json exist purely for the settings UI — forwarding them would
 * silently override the project's own i18n-doctor config file, which must stay
 * the source of truth for analyzer behavior.
 */

export const CONFIG_SECTION = "i18nDoctor";

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

export interface LanguageServerSettings {
  readonly enabled?: boolean;
  readonly debounce?: number;
  readonly logLevel?: LogLevel;
  readonly maxDiagnosticsPerFile?: number;
  readonly coverage?: boolean;
}

export interface ExtensionSettings {
  /** `i18nDoctor.enabled` — always resolved (defaults to true). */
  readonly enabled: boolean;
  /** `i18nDoctor.languageServer.path` — development override, if set. */
  readonly serverPath: string | undefined;
  /** Explicitly-set `i18nDoctor.languageServer.*` values only. */
  readonly languageServer: LanguageServerSettings;
}

/**
 * The slice of `vscode.WorkspaceConfiguration` this module needs. Narrowed so
 * settings logic is testable without an extension host.
 */
export interface ConfigurationReader {
  get<T>(section: string): T | undefined;
  inspect<T>(section: string):
    | {
        readonly globalValue?: T;
        readonly workspaceValue?: T;
        readonly workspaceFolderValue?: T;
        readonly globalLanguageValue?: T;
        readonly workspaceLanguageValue?: T;
        readonly workspaceFolderLanguageValue?: T;
      }
    | undefined;
}

export function readSettings(config: ConfigurationReader): ExtensionSettings {
  const languageServer: {
    debounce?: number;
    logLevel?: LogLevel;
    maxDiagnosticsPerFile?: number;
    coverage?: boolean;
  } = {};

  if (isExplicitlySet(config, "languageServer.debounce")) {
    const value = config.get<number>("languageServer.debounce");
    if (typeof value === "number") languageServer.debounce = value;
  }
  if (isExplicitlySet(config, "languageServer.logLevel")) {
    const value = config.get<LogLevel>("languageServer.logLevel");
    if (typeof value === "string") languageServer.logLevel = value;
  }
  if (isExplicitlySet(config, "languageServer.maxDiagnosticsPerFile")) {
    const value = config.get<number>("languageServer.maxDiagnosticsPerFile");
    if (typeof value === "number") languageServer.maxDiagnosticsPerFile = value;
  }
  if (isExplicitlySet(config, "languageServer.coverage")) {
    const value = config.get<boolean>("languageServer.coverage");
    if (typeof value === "boolean") languageServer.coverage = value;
  }

  const rawPath = config.get<string>("languageServer.path");
  const serverPath =
    typeof rawPath === "string" && rawPath.trim() !== ""
      ? rawPath.trim()
      : undefined;

  return {
    enabled: config.get<boolean>("enabled") ?? true,
    serverPath,
    languageServer,
  };
}

/**
 * The `languageServer` block sent to the server. `i18nDoctor.enabled: false`
 * maps to `languageServer.enabled: false`, which the server honors by clearing
 * every published diagnostic.
 */
export function toLanguageServerBlock(
  settings: ExtensionSettings,
): LanguageServerSettings {
  return {
    ...settings.languageServer,
    ...(settings.enabled ? {} : { enabled: false }),
  };
}

/** Payload for the LSP `initialize` request's `initializationOptions`. */
export function toInitializationOptions(settings: ExtensionSettings): {
  readonly languageServer: LanguageServerSettings;
} {
  return { languageServer: toLanguageServerBlock(settings) };
}

/** Payload for `workspace/didChangeConfiguration`. */
export function toConfigurationParams(settings: ExtensionSettings): {
  readonly settings: { readonly languageServer: LanguageServerSettings };
} {
  return { settings: { languageServer: toLanguageServerBlock(settings) } };
}

function isExplicitlySet(
  config: ConfigurationReader,
  section: string,
): boolean {
  const info = config.inspect(section);
  if (info === undefined) return false;
  return (
    info.globalValue !== undefined ||
    info.workspaceValue !== undefined ||
    info.workspaceFolderValue !== undefined ||
    info.globalLanguageValue !== undefined ||
    info.workspaceLanguageValue !== undefined ||
    info.workspaceFolderLanguageValue !== undefined
  );
}

/**
 * Package names that mark a workspace as i18n-relevant. Mirrors the library
 * catalog in @i18n-doctor/detect — the extension only uses this as a cheap
 * activation gate; real detection stays in the analyzer.
 */
export const I18N_PACKAGE_HINTS: readonly string[] = [
  "i18next",
  "react-i18next",
  "next-i18next",
  "next-intl",
  "use-intl",
  "react-intl",
  "@formatjs/intl",
  "@lingui/core",
  "@lingui/react",
  "@lingui/macro",
  "@lingui/cli",
  "vue-i18n",
  "@nuxtjs/i18n",
  "nuxt-i18n",
  "@ngx-translate/core",
  "@jsverse/transloco",
  "@ngneat/transloco",
  "i18n-doctor",
  "@i18n-doctor/cli",
  "@i18n-doctor/language-server",
];

/**
 * True when a package.json suggests the project uses i18n (dependency on a
 * known i18n library, or an inline `i18n-doctor` config block).
 */
export function packageJsonMentionsI18n(json: unknown): boolean {
  if (typeof json !== "object" || json === null) return false;
  const record = json as Record<string, unknown>;
  if ("i18n-doctor" in record) return true;

  for (const section of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const deps = record[section];
    if (typeof deps !== "object" || deps === null) continue;
    for (const name of Object.keys(deps)) {
      if (I18N_PACKAGE_HINTS.includes(name)) return true;
    }
  }
  return false;
}
