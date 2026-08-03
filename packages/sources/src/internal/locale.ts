/**
 * Locale / BCP-47-ish token detection from path segments and object keys.
 * Conservative: prefers well-known locales; loose mode only in i18n path context.
 */

const LOCALE_RE =
  /^(?:[a-z]{2,3})(?:[_-](?:[A-Z]{2}|\d{3}|[A-Z][a-z]{3}|[a-z]{2}))?(?:[_-](?:[A-Za-z0-9]+))?$/;

const WELL_KNOWN = new Set([
  "en",
  "en-us",
  "en-gb",
  "en-au",
  "en-ca",
  "fr",
  "fr-fr",
  "fr-ca",
  "de",
  "de-de",
  "de-at",
  "de-ch",
  "es",
  "es-es",
  "es-mx",
  "it",
  "it-it",
  "pt",
  "pt-br",
  "pt-pt",
  "nl",
  "nl-nl",
  "pl",
  "pl-pl",
  "ru",
  "ru-ru",
  "ja",
  "ja-jp",
  "ko",
  "ko-kr",
  "zh",
  "zh-cn",
  "zh-tw",
  "zh-hans",
  "zh-hant",
  "ar",
  "ar-sa",
  "tr",
  "tr-tr",
  "sv",
  "sv-se",
  "da",
  "da-dk",
  "fi",
  "fi-fi",
  "no",
  "nb",
  "nn",
  "cs",
  "sk",
  "hu",
  "ro",
  "uk",
  "he",
  "hi",
  "th",
  "vi",
  "id",
  "ms",
  "fa",
  "el",
  "bg",
  "hr",
  "sr",
  "sl",
  "lt",
  "lv",
  "et",
  "ca",
  "eu",
  "gl",
]);

/** Path/code tokens that match locale shape but are never locales. */
const BANNED_TOKENS = new Set([
  "src",
  "app",
  "lib",
  "libs",
  "bin",
  "dev",
  "tmp",
  "var",
  "opt",
  "api",
  "web",
  "ios",
  "css",
  "jsx",
  "tsx",
  "vue",
  "new",
  "old",
  "max",
  "min",
  "map",
  "set",
  "get",
  "put",
  "all",
  "any",
  "not",
  "and",
  "for",
  "key",
  "val",
  "obj",
  "doc",
  "cfg",
  "env",
  "out",
  "dist",
  "build",
  "test",
  "tests",
  "spec",
  "main",
  "page",
  "pages",
  "node",
  "next",
  "nuxt",
  "vite",
  "public",
  "assets",
  "static",
  "shared",
  "common",
  "components",
  "hooks",
  "utils",
  "helpers",
  "types",
  "models",
  "stores",
  "pkg",
  "mod",
  "dir",
  "id",
  "in",
  "is",
  "as",
  "at",
  "be",
  "by",
  "do",
  "go",
  "if",
  "me",
  "my",
  "of",
  "ok",
  "on",
  "or",
  "so",
  "to",
  "up",
  "us",
  "we",
]);

const I18N_PATH_RE =
  /(^|\/)(locales?|i18n|langs?|languages|messages|translations)(\/|$)/i;

export function normalizeLocale(raw: string): string {
  return raw.replace(/_/g, "-");
}

export function isWellKnownLocale(token: string): boolean {
  return WELL_KNOWN.has(normalizeLocale(token).toLowerCase());
}

export function isI18nPathContext(relativePath: string): boolean {
  return I18N_PATH_RE.test(relativePath.replace(/\\/g, "/"));
}

/**
 * @param mode `strict` = well-known only (default for ambiguous paths).
 *             `loose` = well-known or BCP-47-ish (i18n directories / resource maps).
 */
export function looksLikeLocale(
  token: string,
  mode: "strict" | "loose" = "loose",
): boolean {
  if (!token || token.length > 20) {
    return false;
  }
  const normalized = normalizeLocale(token);
  const lower = normalized.toLowerCase();

  if (BANNED_TOKENS.has(lower)) {
    return WELL_KNOWN.has(lower);
  }
  if (WELL_KNOWN.has(lower)) {
    return true;
  }
  if (mode === "strict") {
    return false;
  }
  // Loose: require locale-shaped token; prefer region/script form for unknowns.
  if (!LOCALE_RE.test(normalized)) {
    return false;
  }
  // Bare 2-3 letter unknowns (xx, abc) are too ambiguous unless well-known.
  if (!normalized.includes("-") && lower.length <= 3) {
    return false;
  }
  return true;
}

/**
 * Infer locale from a relative path.
 * Examples: locales/en/common.json → en
 *           messages/en-US.json → en-US
 *           i18n/fr.yaml → fr
 *           messages/xx-YY.json → xx-YY (unknown but shaped, in i18n context)
 */
export function inferLocaleFromPath(relativePath: string): string | undefined {
  const normalized = relativePath.replace(/\\/g, "/");
  const inI18n = isI18nPathContext(normalized);
  const mode = inI18n ? "loose" : "strict";
  const parts = normalized.split("/");
  const base = parts[parts.length - 1] ?? "";
  const stem = base.replace(/\.(json|ya?ml|jsx?|tsx?|mjs|cjs|mts|cts)$/i, "");

  if (looksLikeLocale(stem, mode)) {
    return normalizeLocale(stem);
  }
  const dotted = stem.split(".");
  for (let i = dotted.length - 1; i >= 0; i -= 1) {
    const part = dotted[i];
    if (part && looksLikeLocale(part, mode)) {
      return normalizeLocale(part);
    }
  }

  for (let i = parts.length - 2; i >= 0; i -= 1) {
    const seg = parts[i];
    if (seg && looksLikeLocale(seg, mode)) {
      return normalizeLocale(seg);
    }
  }

  return undefined;
}

/** True when an object key set looks like a locale map (i18next / vue-i18n). */
export function looksLikeLocaleMap(keys: readonly string[]): boolean {
  if (keys.length === 0) {
    return false;
  }
  const localeLike = keys.filter((k) => looksLikeLocale(k, "loose"));
  const wellKnown = localeLike.filter((k) => isWellKnownLocale(k));
  const ratio = localeLike.length / keys.length;
  if (ratio < 0.6) {
    return false;
  }
  // Require at least one well-known locale, or 2+ loose locales (e.g. xx-YY, zz-AA).
  return wellKnown.length >= 1 || localeLike.length >= 2;
}
