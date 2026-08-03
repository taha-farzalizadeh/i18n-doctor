import type { LibraryUsageDetector } from "../../api/types.js";
import { angularUsageDetector } from "./angular.js";
import { i18nextUsageDetector } from "./i18next.js";
import { linguiUsageDetector } from "./lingui.js";
import { nextIntlUsageDetector } from "./next-intl.js";
import { reactIntlUsageDetector } from "./react-intl.js";
import { vueI18nUsageDetector } from "./vue-i18n.js";

export const LIBRARY_USAGE_DETECTORS: readonly LibraryUsageDetector[] = [
  i18nextUsageDetector,
  nextIntlUsageDetector,
  reactIntlUsageDetector,
  linguiUsageDetector,
  vueI18nUsageDetector,
  angularUsageDetector,
];
