import { createI18nRule } from "../internal/rule-utils.js";

export const noUnusedKey = createI18nRule({
  kind: "no-unused-key",
  description:
    "Disallow translation keys defined in catalogs but never used in source code.",
  recommendedSeverity: "warn",
});
