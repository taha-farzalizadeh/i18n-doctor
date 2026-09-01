import { createI18nRule } from "../internal/rule-utils.js";

export const localeConsistency = createI18nRule({
  kind: "locale-consistency",
  description:
    "Require translation keys to be present consistently across configured locales.",
  recommendedSeverity: "warn",
});
