import type {
  FrameworkId,
  I18nLibraryId,
  PackageManagerId,
} from "../api/types.js";

export interface PackageSignal {
  readonly name: string;
  readonly weight: number;
  readonly section?: "dependency" | "devDependency" | "peerDependency" | "any";
}

export interface FrameworkSpec {
  readonly id: FrameworkId;
  readonly name: string;
  readonly packages: readonly PackageSignal[];
  readonly configFiles: readonly string[];
  readonly directories: readonly string[];
  readonly imports: readonly string[];
}

export interface I18nInitPath {
  readonly path: string;
  /** Only count when package/import evidence already exists. */
  readonly generic?: boolean;
  /** Treat as directory prefix match. */
  readonly directory?: boolean;
}

export interface I18nSpec {
  readonly id: I18nLibraryId;
  readonly name: string;
  readonly packages: readonly PackageSignal[];
  readonly imports: readonly string[];
  readonly initFiles: readonly I18nInitPath[];
  readonly providers: readonly string[];
}

export const FRAMEWORK_SPECS: readonly FrameworkSpec[] = [
  {
    id: "nextjs",
    name: "Next.js",
    packages: [{ name: "next", weight: 0.55 }],
    configFiles: [
      "next.config.js",
      "next.config.mjs",
      "next.config.cjs",
      "next.config.ts",
      "next.config.mts",
    ],
    directories: ["app", "pages", "src/app", "src/pages"],
    imports: [
      "next",
      "next/router",
      "next/navigation",
      "next/link",
      "next/image",
      "next/head",
      "next/script",
      "next/dynamic",
    ],
  },
  {
    id: "expo",
    name: "Expo",
    packages: [
      { name: "expo", weight: 0.55 },
      { name: "expo-router", weight: 0.35 },
    ],
    // app.json handled specially (must contain expo key)
    configFiles: ["app.config.js", "app.config.ts", "app.config.mjs", "expo.json"],
    directories: [],
    imports: ["expo", "expo-router", "expo-constants"],
  },
  {
    id: "react-native",
    name: "React Native",
    packages: [
      { name: "react-native", weight: 0.55 },
      { name: "@react-native/metro-config", weight: 0.25, section: "devDependency" },
      { name: "react-native-web", weight: 0.2 },
    ],
    configFiles: [
      "metro.config.js",
      "metro.config.cjs",
      "metro.config.mjs",
      "metro.config.ts",
      "react-native.config.js",
      "react-native.config.ts",
    ],
    directories: [],
    imports: ["react-native"],
  },
  {
    id: "nuxt",
    name: "Nuxt",
    packages: [
      { name: "nuxt", weight: 0.55 },
      { name: "nuxt3", weight: 0.4 },
      { name: "@nuxt/kit", weight: 0.25, section: "devDependency" },
    ],
    configFiles: ["nuxt.config.js", "nuxt.config.ts", "nuxt.config.mjs"],
    directories: [],
    // Avoid bare #app/#imports — too common outside Nuxt without a dep signal.
    imports: ["nuxt", "nuxt/app"],
  },
  {
    id: "angular",
    name: "Angular",
    packages: [
      { name: "@angular/core", weight: 0.55 },
      { name: "@angular/common", weight: 0.35 },
      { name: "@angular/cli", weight: 0.3, section: "devDependency" },
      { name: "@angular/platform-browser", weight: 0.3 },
    ],
    configFiles: ["angular.json"],
    directories: [],
    imports: ["@angular/core", "@angular/common", "@angular/platform-browser"],
  },
  {
    id: "svelte",
    name: "Svelte",
    packages: [
      { name: "svelte", weight: 0.5 },
      { name: "@sveltejs/kit", weight: 0.45 },
      { name: "@sveltejs/vite-plugin-svelte", weight: 0.25, section: "devDependency" },
    ],
    configFiles: ["svelte.config.js", "svelte.config.ts", "svelte.config.mjs"],
    directories: [],
    imports: ["svelte", "@sveltejs/kit"],
  },
  {
    id: "vue",
    name: "Vue",
    packages: [
      { name: "vue", weight: 0.5 },
      { name: "@vitejs/plugin-vue", weight: 0.25, section: "devDependency" },
      { name: "vue-router", weight: 0.25 },
    ],
    configFiles: ["vue.config.js", "vue.config.ts"],
    directories: [],
    imports: ["vue", "vue-router"],
  },
  {
    id: "cra",
    name: "Create React App",
    packages: [
      { name: "react-scripts", weight: 0.55, section: "any" },
    ],
    configFiles: [],
    directories: ["public"],
    imports: [],
  },
  {
    id: "vite",
    name: "Vite",
    packages: [
      { name: "vite", weight: 0.45, section: "any" },
      { name: "@vitejs/plugin-react", weight: 0.25, section: "devDependency" },
      { name: "@vitejs/plugin-vue", weight: 0.2, section: "devDependency" },
    ],
    configFiles: [
      "vite.config.js",
      "vite.config.ts",
      "vite.config.mjs",
      "vite.config.cjs",
      "vite.config.mts",
    ],
    directories: [],
    imports: ["vite"],
  },
  {
    id: "react",
    name: "React",
    packages: [
      { name: "react", weight: 0.45 },
      { name: "react-dom", weight: 0.35 },
    ],
    configFiles: [],
    directories: [],
    imports: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
];

export const I18N_SPECS: readonly I18nSpec[] = [
  {
    id: "next-intl",
    name: "next-intl",
    packages: [{ name: "next-intl", weight: 0.55 }],
    imports: ["next-intl", "next-intl/server", "use-intl"],
    initFiles: [
      { path: "i18n.ts", generic: true },
      { path: "i18n.js", generic: true },
      { path: "src/i18n.ts", generic: true },
      { path: "src/i18n.js", generic: true },
      { path: "i18n/request.ts", generic: true },
      { path: "src/i18n/request.ts", generic: true },
      // messages/ alone is too ambiguous — only with package/import
      { path: "messages", generic: true, directory: true },
    ],
    providers: ["NextIntlClientProvider", "useTranslations", "useFormatter"],
  },
  {
    id: "next-i18next",
    name: "next-i18next",
    packages: [{ name: "next-i18next", weight: 0.55 }],
    imports: ["next-i18next", "next-i18next/serverSideTranslations"],
    initFiles: [
      { path: "next-i18next.config.js" },
      { path: "next-i18next.config.cjs" },
      { path: "next-i18next.config.ts" },
      { path: "next-i18next.config.mjs" },
    ],
    providers: ["appWithTranslation", "useTranslation"],
  },
  {
    id: "react-i18next",
    name: "react-i18next",
    packages: [{ name: "react-i18next", weight: 0.55 }],
    imports: ["react-i18next"],
    initFiles: [
      { path: "i18n.ts", generic: true },
      { path: "i18n.js", generic: true },
      { path: "src/i18n.ts", generic: true },
      { path: "src/i18n.js", generic: true },
    ],
    providers: ["I18nextProvider", "useTranslation", "initReactI18next", "withTranslation"],
  },
  {
    id: "i18next",
    name: "i18next",
    packages: [{ name: "i18next", weight: 0.5 }],
    imports: ["i18next"],
    initFiles: [
      { path: "i18n.ts", generic: true },
      { path: "i18n.js", generic: true },
      { path: "src/i18n.ts", generic: true },
    ],
    providers: [],
  },
  {
    id: "react-intl",
    name: "react-intl",
    packages: [{ name: "react-intl", weight: 0.55 }],
    imports: ["react-intl"],
    initFiles: [],
    providers: ["IntlProvider", "FormattedMessage", "useIntl"],
  },
  {
    id: "formatjs",
    name: "FormatJS",
    packages: [
      { name: "@formatjs/intl", weight: 0.45 },
      { name: "@formatjs/cli", weight: 0.3, section: "devDependency" },
      { name: "babel-plugin-formatjs", weight: 0.25, section: "devDependency" },
      { name: "eslint-plugin-formatjs", weight: 0.2, section: "devDependency" },
    ],
    imports: ["@formatjs/intl", "@formatjs/macro"],
    initFiles: [],
    providers: [],
  },
  {
    id: "lingui",
    name: "Lingui",
    packages: [
      { name: "@lingui/core", weight: 0.45 },
      { name: "@lingui/react", weight: 0.45 },
      { name: "@lingui/cli", weight: 0.3, section: "devDependency" },
      { name: "@lingui/macro", weight: 0.3 },
    ],
    imports: ["@lingui/core", "@lingui/react", "@lingui/macro"],
    initFiles: [
      { path: ".linguirc" },
      { path: "lingui.config.js" },
      { path: "lingui.config.ts" },
      { path: "lingui.config.mjs" },
    ],
    // I18nProvider is generic — only counted when package/import already present
    providers: ["I18nProvider", "Trans", "useLingui"],
  },
  {
    id: "vue-i18n",
    name: "vue-i18n",
    packages: [{ name: "vue-i18n", weight: 0.55 }],
    imports: ["vue-i18n"],
    initFiles: [
      { path: "i18n.ts", generic: true },
      { path: "i18n.js", generic: true },
      { path: "src/i18n.ts", generic: true },
    ],
    providers: ["createI18n", "useI18n"],
  },
  {
    id: "nuxt-i18n",
    name: "nuxt-i18n",
    packages: [
      { name: "@nuxtjs/i18n", weight: 0.55 },
      { name: "nuxt-i18n", weight: 0.45 },
    ],
    imports: ["#i18n", "@nuxtjs/i18n"],
    initFiles: [
      { path: "i18n.config.ts" },
      { path: "i18n.config.js" },
      { path: "i18n.config.mjs" },
    ],
    providers: ["useLocalePath", "useI18n"],
  },
  {
    id: "ngx-translate",
    name: "ngx-translate",
    packages: [
      { name: "@ngx-translate/core", weight: 0.55 },
      { name: "@ngx-translate/http-loader", weight: 0.3 },
    ],
    imports: ["@ngx-translate/core"],
    initFiles: [],
    providers: ["TranslateModule", "TranslateService", "TranslatePipe"],
  },
  {
    id: "transloco",
    name: "Transloco",
    packages: [
      { name: "@jsverse/transloco", weight: 0.55 },
      { name: "@ngneat/transloco", weight: 0.5 },
    ],
    imports: ["@jsverse/transloco", "@ngneat/transloco"],
    initFiles: [
      { path: "transloco.config.ts" },
      { path: "transloco.config.js" },
    ],
    providers: ["TranslocoModule", "TranslocoService", "provideTransloco", "TranslocoPipe"],
  },
];

/** Provider/API identifiers collected during AST walks (whitelist). */
export const PROVIDER_IDENTIFIERS: ReadonlySet<string> = new Set(
  I18N_SPECS.flatMap((spec) => spec.providers),
);

export const PACKAGE_MANAGER_LOCKFILES: ReadonlyArray<{
  id: PackageManagerId;
  name: string;
  files: readonly string[];
  weight: number;
  /** Files that are lockfiles (strong) vs workspace/config (weaker). */
  lockFiles?: readonly string[];
}> = [
  {
    id: "pnpm",
    name: "pnpm",
    files: ["pnpm-lock.yaml", "pnpm-workspace.yaml"],
    lockFiles: ["pnpm-lock.yaml"],
    weight: 0.7,
  },
  {
    id: "yarn",
    name: "Yarn",
    files: ["yarn.lock", ".yarnrc.yml", ".yarnrc"],
    lockFiles: ["yarn.lock"],
    weight: 0.65,
  },
  {
    id: "bun",
    name: "Bun",
    files: ["bun.lockb", "bun.lock"],
    lockFiles: ["bun.lockb", "bun.lock"],
    weight: 0.7,
  },
  {
    id: "npm",
    name: "npm",
    files: ["package-lock.json", "npm-shrinkwrap.json"],
    lockFiles: ["package-lock.json", "npm-shrinkwrap.json"],
    weight: 0.65,
  },
];

/** Basenames prioritized when sampling source files for import signals. */
export const PRIORITY_SOURCE_BASENAMES = new Set([
  "i18n.ts",
  "i18n.js",
  "i18n.tsx",
  "i18n.jsx",
  "locale.ts",
  "locale.js",
  "locales.ts",
  "translation.ts",
  "translations.ts",
  "layout.tsx",
  "layout.jsx",
  "layout.js",
  "layout.ts",
  "_app.tsx",
  "_app.jsx",
  "_app.js",
  "_document.tsx",
  "main.ts",
  "main.tsx",
  "main.js",
  "main.jsx",
  "index.ts",
  "index.tsx",
  "index.js",
  "index.jsx",
  "app.tsx",
  "app.jsx",
  "app.ts",
  "app.js",
  "provider.tsx",
  "provider.ts",
  "providers.tsx",
  "plugin.ts",
  "plugins.ts",
]);
