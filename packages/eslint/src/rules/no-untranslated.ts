import { createI18nRule } from "../internal/rule-utils.js";

export const noUntranslated = createI18nRule({
  kind: "no-untranslated",
  description:
    "Disallow hardcoded user-facing text that is not passed through a translator.",
  recommendedSeverity: "warn",
});
