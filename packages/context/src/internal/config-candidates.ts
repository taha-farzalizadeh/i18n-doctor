/**
 * Known configuration file paths for i18n libraries.
 * Discovery is path-based — files are never executed.
 */

export interface ConfigCandidateSpec {
  readonly relativePath: string;
  /** Prefer matching this library when parsing succeeds. */
  readonly libraryHint?: string;
  readonly kindHint?: string;
}

/** Root-relative candidate paths (checked per package root). */
export const CONFIG_CANDIDATES: readonly ConfigCandidateSpec[] = [
  // i18next / react-i18next
  { relativePath: "i18n.ts", libraryHint: "i18next", kindHint: "i18n-module" },
  { relativePath: "i18n.js", libraryHint: "i18next", kindHint: "i18n-module" },
  { relativePath: "i18n.mjs", libraryHint: "i18next", kindHint: "i18n-module" },
  { relativePath: "i18n.cjs", libraryHint: "i18next", kindHint: "i18n-module" },
  { relativePath: "src/i18n.ts", libraryHint: "i18next", kindHint: "i18n-module" },
  { relativePath: "src/i18n.js", libraryHint: "i18next", kindHint: "i18n-module" },
  { relativePath: "src/i18n/index.ts", libraryHint: "i18next", kindHint: "i18n-module" },
  { relativePath: "src/i18n/index.js", libraryHint: "i18next", kindHint: "i18n-module" },
  { relativePath: "lib/i18n.ts", libraryHint: "i18next", kindHint: "i18n-module" },
  { relativePath: "app/i18n.ts", libraryHint: "i18next", kindHint: "i18n-module" },

  // next-i18next
  { relativePath: "next-i18next.config.js", libraryHint: "next-i18next", kindHint: "next-i18next" },
  { relativePath: "next-i18next.config.cjs", libraryHint: "next-i18next", kindHint: "next-i18next" },
  { relativePath: "next-i18next.config.mjs", libraryHint: "next-i18next", kindHint: "next-i18next" },
  { relativePath: "next-i18next.config.ts", libraryHint: "next-i18next", kindHint: "next-i18next" },

  // next-intl
  { relativePath: "i18n/request.ts", libraryHint: "next-intl", kindHint: "next-intl" },
  { relativePath: "i18n/request.js", libraryHint: "next-intl", kindHint: "next-intl" },
  { relativePath: "src/i18n/request.ts", libraryHint: "next-intl", kindHint: "next-intl" },
  { relativePath: "src/i18n/request.js", libraryHint: "next-intl", kindHint: "next-intl" },
  { relativePath: "i18n/routing.ts", libraryHint: "next-intl", kindHint: "next-intl" },
  { relativePath: "src/i18n/routing.ts", libraryHint: "next-intl", kindHint: "next-intl" },
  { relativePath: "src/i18n/config.ts", libraryHint: "next-intl", kindHint: "next-intl" },
  { relativePath: "i18n/config.ts", libraryHint: "next-intl", kindHint: "next-intl" },

  // next.config.*
  { relativePath: "next.config.js", libraryHint: "unknown", kindHint: "next-config" },
  { relativePath: "next.config.mjs", libraryHint: "unknown", kindHint: "next-config" },
  { relativePath: "next.config.cjs", libraryHint: "unknown", kindHint: "next-config" },
  { relativePath: "next.config.ts", libraryHint: "unknown", kindHint: "next-config" },
  { relativePath: "next.config.mts", libraryHint: "unknown", kindHint: "next-config" },

  // vue-i18n / nuxt-i18n
  { relativePath: "i18n.config.ts", libraryHint: "nuxt-i18n", kindHint: "nuxt-i18n" },
  { relativePath: "i18n.config.js", libraryHint: "nuxt-i18n", kindHint: "nuxt-i18n" },
  { relativePath: "i18n.config.mjs", libraryHint: "nuxt-i18n", kindHint: "nuxt-i18n" },
  { relativePath: "nuxt.config.ts", libraryHint: "nuxt-i18n", kindHint: "nuxt-i18n" },
  { relativePath: "nuxt.config.js", libraryHint: "nuxt-i18n", kindHint: "nuxt-i18n" },
];

/** Basename patterns that may appear deeper under src/ or packages/. */
export const CONFIG_BASENAME_HINTS = new Set([
  "i18n.ts",
  "i18n.js",
  "i18n.mjs",
  "i18n.cjs",
  "next-i18next.config.js",
  "next-i18next.config.cjs",
  "next-i18next.config.mjs",
  "next-i18next.config.ts",
  "i18n.config.ts",
  "i18n.config.js",
  "i18n.config.mjs",
]);
