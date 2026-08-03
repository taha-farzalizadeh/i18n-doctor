import { looksLikeLocale } from "./locale.js";

/** Stems that are directory/file conventions, not namespaces — unless under a locale dir. */
const IGNORED_STEMS = new Set([
  "index",
  "messages",
  "locales",
  "locale",
  "i18n",
  "lang",
  "langs",
  "languages",
]);

/** Allowed as namespace when they are the resource filename (i18next default NS). */
const RESOURCE_NS_STEMS = new Set(["translation", "translations"]);

/**
 * Infer namespace from path.
 * locales/en/common.json → common
 * messages/common.en.json → common
 * locales/en/translation.json → translation
 */
export function inferNamespaceFromPath(relativePath: string): string | undefined {
  const normalized = relativePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const base = parts[parts.length - 1] ?? "";
  const stem = base.replace(/\.(json|ya?ml|jsx?|tsx?|mjs|cjs|mts|cts)$/i, "");

  const dotted = stem.split(".").filter(Boolean);
  if (dotted.length >= 2) {
    const maybeNs = dotted[0];
    const maybeLocale = dotted[dotted.length - 1];
    if (
      maybeNs &&
      maybeLocale &&
      looksLikeLocale(maybeLocale, "loose") &&
      !looksLikeLocale(maybeNs, "loose") &&
      !IGNORED_STEMS.has(maybeNs.toLowerCase())
    ) {
      return maybeNs;
    }
  }

  if (stem && !looksLikeLocale(stem, "loose")) {
    const lower = stem.toLowerCase();
    if (RESOURCE_NS_STEMS.has(lower)) {
      return stem;
    }
    if (!IGNORED_STEMS.has(lower)) {
      return stem;
    }
  }

  // locales/common/en.json → common
  if (parts.length >= 2) {
    const parent = parts[parts.length - 2];
    if (
      parent &&
      !looksLikeLocale(parent, "loose") &&
      !IGNORED_STEMS.has(parent.toLowerCase()) &&
      looksLikeLocale(stem, "loose")
    ) {
      return parent;
    }
  }

  return undefined;
}

export function looksLikeNamespaceKey(key: string): boolean {
  if (!key || looksLikeLocale(key, "loose")) {
    return false;
  }
  if (key.includes(".") || key.includes("/")) {
    return false;
  }
  return /^[A-Za-z][\w-]*$/.test(key);
}
