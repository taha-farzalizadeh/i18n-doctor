/**
 * Default translation-function seeds.
 *
 * Kept separate from graph construction so the call-graph core stays
 * i18n-agnostic — callers may replace or extend these seeds.
 */

import type { TranslationSeed } from "../api/types.js";

export const DEFAULT_TRANSLATION_SEEDS: readonly TranslationSeed[] = [
  {
    name: "t",
    modules: [
      "i18next",
      "react-i18next",
      "next-i18next",
      "next-intl",
      "vue-i18n",
    ],
    confidence: 0.95,
  },
  {
    name: "translate",
    modules: ["i18next", "react-i18next", "@ngx-translate/core"],
    confidence: 0.85,
  },
  {
    member: { property: "t" },
    modules: ["i18next", "react-i18next", "next-i18next", "vue-i18n"],
    confidence: 0.9,
  },
  {
    member: { object: "i18n", property: "t" },
    confidence: 0.92,
  },
  {
    member: { object: "i18next", property: "t" },
    confidence: 0.92,
  },
  {
    hook: "useTranslation",
    modules: ["react-i18next", "next-i18next"],
    confidence: 0.9,
  },
  {
    hook: "useTranslations",
    modules: ["next-intl"],
    confidence: 0.9,
  },
  {
    name: "$t",
    modules: ["vue-i18n"],
    confidence: 0.9,
  },
  {
    name: "formatMessage",
    modules: ["react-intl", "@formatjs/intl"],
    confidence: 0.9,
  },
];
