import { createI18nRule } from "../internal/rule-utils.js";

export const noDuplicateKey = createI18nRule({
  kind: "no-duplicate-key",
  description:
    "Disallow duplicate translation key definitions within the same namespace.",
  recommendedSeverity: "error",
});
