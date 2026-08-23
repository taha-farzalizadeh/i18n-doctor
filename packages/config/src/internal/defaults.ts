import type {
  LanguageServerConfig,
  LanguageServerLogLevel,
  OutputConfig,
  RuleId,
  RuleSeverity,
  UserConfig,
} from "../api/types.js";

export const RULE_IDS: readonly RuleId[] = [
  "unused-key",
  "missing-key",
  "duplicate-key",
] as const;

export const DEFAULT_RULE_SEVERITIES: Readonly<Record<RuleId, RuleSeverity>> = {
  "unused-key": "warning",
  "missing-key": "error",
  "duplicate-key": "warning",
};

export const DEFAULT_OUTPUT: Required<OutputConfig> = {
  format: "terminal",
  file: "",
  color: true,
  verbose: false,
};

export const LANGUAGE_SERVER_LOG_LEVELS: readonly LanguageServerLogLevel[] = [
  "silent",
  "error",
  "warn",
  "info",
  "debug",
] as const;

export const DEFAULT_LANGUAGE_SERVER: Required<LanguageServerConfig> = {
  enabled: true,
  debounce: 250,
  logLevel: "error",
  maxDiagnosticsPerFile: 500,
  coverage: true,
};

export const DEFAULT_USER_CONFIG: Required<
  Pick<
    UserConfig,
    | "ignoreKeys"
    | "ignoreFiles"
    | "ignoreLocales"
    | "ignoreNamespaces"
    | "include"
    | "exclude"
    | "exitOnError"
    | "failOnWarning"
    | "minConfidence"
  >
> = {
  ignoreKeys: [],
  ignoreFiles: [],
  ignoreLocales: [],
  ignoreNamespaces: [],
  include: ["**/*"],
  exclude: [],
  exitOnError: true,
  failOnWarning: false,
  minConfidence: 0,
};

export const CONFIG_FILENAMES = [
  "i18n-doctor.config.ts",
  "i18n-doctor.config.js",
  "i18n-doctor.config.mjs",
  "i18n-doctor.config.cjs",
  "i18n-doctor.config.json",
] as const;

export const SEVERITY_ALIASES: Readonly<Record<string, RuleSeverity>> = {
  off: "off",
  false: "off",
  "0": "off",
  info: "info",
  warning: "warning",
  warn: "warning",
  error: "error",
  true: "error",
  "1": "warning",
  "2": "error",
};
