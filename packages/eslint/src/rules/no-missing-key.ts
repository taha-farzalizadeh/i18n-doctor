import { createI18nRule } from "../internal/rule-utils.js";

export const noMissingKey = createI18nRule({
  kind: "no-missing-key",
  description:
    "Disallow translation key usages that are missing from translation sources.",
  recommendedSeverity: "error",
});
