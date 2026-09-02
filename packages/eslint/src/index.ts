import type { ESLint, Rule } from "eslint";
import json from "@eslint/json";
import {
  localeConsistency,
  noDuplicateKey,
  noMissingKey,
  noUntranslated,
  noUnusedKey,
} from "./rules/index.js";

const rules: Record<string, Rule.RuleModule> = {
  "no-missing-key": noMissingKey,
  "no-unused-key": noUnusedKey,
  "no-untranslated": noUntranslated,
  "no-duplicate-key": noDuplicateKey,
  "locale-consistency": localeConsistency,
};

export const recommendedRules = {
  "i18n-doctor/no-missing-key": "error",
  "i18n-doctor/no-unused-key": "warn",
  "i18n-doctor/no-untranslated": "warn",
  "i18n-doctor/no-duplicate-key": "error",
  "i18n-doctor/locale-consistency": "warn",
} as const;

const plugin: ESLint.Plugin = {
  meta: {
    name: "@i18n-doctor/eslint-plugin",
    version: "0.10.2",
  },
  rules,
};

plugin.configs = {
  recommended: [
    {
      name: "i18n-doctor/recommended",
      plugins: {
        "i18n-doctor": plugin,
      },
      rules: recommendedRules,
    },
    {
      name: "i18n-doctor/recommended-locales",
      files: ["**/*.json"],
      plugins: {
        json: json as unknown as ESLint.Plugin,
        "i18n-doctor": plugin,
      },
      language: "json/json",
      rules: {
        "i18n-doctor/no-unused-key": "warn",
        "i18n-doctor/no-duplicate-key": "error",
        "i18n-doctor/locale-consistency": "warn",
      },
    },
  ],
};

export default plugin;

export {
  localeConsistency,
  noDuplicateKey,
  noMissingKey,
  noUntranslated,
  noUnusedKey,
  rules,
};

export {
  getAnalysisSession,
  getAnalyzeScopeCallCount,
  resetAnalysisSessions,
} from "./internal/analysis-session.js";

export { issueToEslintDiagnostic } from "./internal/diagnostic-adapter.js";
export { issueLocationToEslint, toEslintLocation } from "./internal/locations.js";
export { RULE_MESSAGES } from "./internal/messages.js";

/**
 * Typed config helper — re-exported so ESLint users do not need a separate
 * `i18n-doctor` install for `i18n-doctor.config.ts`. Plain JSON / object
 * configs need no import at all.
 */
export { defineConfig } from "@i18n-doctor/config";
