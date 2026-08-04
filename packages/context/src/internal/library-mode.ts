/**
 * Framework resolution modes.
 * next-intl message namespaces are key-path prefixes, not i18next resource files.
 */

import type { ConfigLibraryId } from "../api/types.js";

export type ResolutionMode =
  | "i18next"
  | "next-intl"
  | "vue-i18n"
  | "generic";

export function resolutionModeFor(
  library: string | undefined,
): ResolutionMode {
  switch (library) {
    case "i18next":
    case "react-i18next":
    case "next-i18next":
      return "i18next";
    case "next-intl":
      return "next-intl";
    case "vue-i18n":
    case "nuxt-i18n":
      return "vue-i18n";
    default:
      return "generic";
  }
}

export function isI18nextFamily(library: string | undefined): boolean {
  return resolutionModeFor(library) === "i18next";
}

export function normalizeLibraryId(
  library: string | undefined,
): ConfigLibraryId | undefined {
  if (!library) return undefined;
  const known: ConfigLibraryId[] = [
    "i18next",
    "react-i18next",
    "next-i18next",
    "next-intl",
    "vue-i18n",
    "nuxt-i18n",
    "unknown",
  ];
  return (known as string[]).includes(library)
    ? (library as ConfigLibraryId)
    : "unknown";
}
