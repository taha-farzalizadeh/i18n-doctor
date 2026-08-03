import { describe, expect, it } from "vitest";
import { createDetector, formatDetectionReport } from "../src/index.js";
import { fixture, pkg } from "./helpers.js";

describe("i18n library detection", () => {
  it("detects next-intl with App Router", async () => {
    const root = await fixture({
      "package.json": pkg({
        packageManager: "pnpm@9.0.0",
        dependencies: {
          next: "15.0.0",
          react: "19.0.0",
          "react-dom": "19.0.0",
          "next-intl": "3.0.0",
        },
      }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
      "next.config.ts": "export default {};\n",
      "src/app/layout.tsx": `
        import { NextIntlClientProvider } from 'next-intl';
        export default function Layout({ children }: { children: React.ReactNode }) {
          return <NextIntlClientProvider>{children}</NextIntlClientProvider>;
        }
      `,
    });
    const result = await createDetector().detect({ root });
    expect(result.primary.i18nLibrary?.id).toBe("next-intl");
    expect(result.primary.framework?.id).toBe("nextjs");
    expect(formatDetectionReport(result)).toContain("next-intl");
  });

  it("detects react-i18next and demotes bare i18next", async () => {
    const root = await fixture({
      "package.json": pkg({
        dependencies: {
          react: "18.0.0",
          i18next: "23.0.0",
          "react-i18next": "14.0.0",
        },
      }),
      "yarn.lock": "# yarn lockfile v1\n",
      "src/i18n.ts": `
        import i18n from 'i18next';
        import { initReactI18next } from 'react-i18next';
        i18n.use(initReactI18next).init({});
        export default i18n;
      `,
      "src/App.tsx": `
        import { useTranslation, I18nextProvider } from 'react-i18next';
        export function App() {
          const { t } = useTranslation();
          return <I18nextProvider i18n={{} as any}><span>{t('k')}</span></I18nextProvider>;
        }
      `,
    });
    const result = await createDetector().detect({ root });
    expect(result.primary.i18nLibrary?.id).toBe("react-i18next");
    expect(result.primary.packageManager?.id).toBe("yarn");
    const core = result.i18nLibraries.find((l) => l.id === "i18next");
    expect(core).toBeDefined();
    expect(core!.confidence).toBeLessThanOrEqual(0.45);
  });

  it("detects multiple i18n libraries and reports ambiguity", async () => {
    const root = await fixture({
      "package.json": pkg({
        dependencies: {
          react: "18.0.0",
          "react-intl": "6.0.0",
          "react-i18next": "14.0.0",
          i18next: "23.0.0",
          "@formatjs/intl": "2.0.0",
        },
      }),
      "src/a.tsx": `import { IntlProvider } from 'react-intl'; export const A = () => <IntlProvider locale="en"><div/></IntlProvider>;`,
      "src/b.tsx": `import { useTranslation } from 'react-i18next'; export const B = () => { useTranslation(); return null; };`,
    });
    const result = await createDetector().detect({ root });
    expect(result.i18nLibraries.length).toBeGreaterThanOrEqual(2);
    expect(
      result.unknowns.some((u) => u.category === "i18n-library"),
    ).toBe(true);
  });

  it("detects custom wrapper re-exports", async () => {
    const root = await fixture({
      "package.json": pkg({
        dependencies: {
          react: "18.0.0",
          "react-i18next": "14.0.0",
          i18next: "23.0.0",
        },
      }),
      "src/lib/i18n.ts": `
        export { useTranslation, Trans } from 'react-i18next';
        export { default as i18n } from 'i18next';
      `,
      "src/App.tsx": `
        import { useTranslation } from './lib/i18n';
        export function App() { const { t } = useTranslation(); return <span>{t('x')}</span>; }
      `,
    });
    const result = await createDetector().detect({ root });
    expect(result.i18nLibraries.some((l) => l.id === "react-i18next")).toBe(true);
  });

  it("detects vue-i18n", async () => {
    const root = await fixture({
      "package.json": pkg({
        dependencies: { vue: "3.5.0", "vue-i18n": "9.0.0" },
      }),
      "package-lock.json": JSON.stringify({ lockfileVersion: 3 }),
      "vite.config.ts": `import { defineConfig } from 'vite'; export default defineConfig({});`,
      "src/main.ts": `
        import { createApp } from 'vue';
        import { createI18n } from 'vue-i18n';
        createApp({}).use(createI18n({})).mount('#app');
      `,
    });
    const result = await createDetector().detect({ root });
    expect(result.primary.i18nLibrary?.id).toBe("vue-i18n");
    expect(result.primary.packageManager?.id).toBe("npm");
  });

  it("detects nuxt-i18n", async () => {
    const root = await fixture({
      "package.json": pkg({
        dependencies: { nuxt: "3.14.0", "@nuxtjs/i18n": "9.0.0" },
      }),
      "nuxt.config.ts": "export default {};\n",
      "i18n.config.ts": "export default {};\n",
    });
    const result = await createDetector().detect({ root });
    expect(result.i18nLibraries.some((l) => l.id === "nuxt-i18n")).toBe(true);
  });

  it("detects Angular Transloco", async () => {
    const root = await fixture({
      "package.json": pkg({
        dependencies: {
          "@angular/core": "19.0.0",
          "@jsverse/transloco": "7.0.0",
        },
      }),
      "angular.json": JSON.stringify({ version: 1, projects: {} }),
      "src/app/app.ts": `
        import { Component } from '@angular/core';
        import { TranslocoService } from '@jsverse/transloco';
        @Component({ selector: 'app-root', template: '' })
        export class App { constructor(private t: TranslocoService) {} }
      `,
    });
    const result = await createDetector().detect({ root });
    expect(result.primary.framework?.id).toBe("angular");
    expect(result.i18nLibraries.some((l) => l.id === "transloco")).toBe(true);
  });

  it("detects ngx-translate", async () => {
    const root = await fixture({
      "package.json": pkg({
        dependencies: {
          "@angular/core": "19.0.0",
          "@ngx-translate/core": "16.0.0",
        },
      }),
      "src/app.ts": `import { TranslateModule } from '@ngx-translate/core'; export { TranslateModule };`,
    });
    const result = await createDetector().detect({ root });
    expect(result.i18nLibraries.some((l) => l.id === "ngx-translate")).toBe(true);
  });

  it("detects Lingui", async () => {
    const root = await fixture({
      "package.json": pkg({
        dependencies: { react: "18.0.0", "@lingui/core": "4.0.0", "@lingui/react": "4.0.0" },
      }),
      "lingui.config.ts": "export default {};\n",
      "src/App.tsx": `
        import { I18nProvider } from '@lingui/react';
        export const App = () => <I18nProvider i18n={{} as any}><div/></I18nProvider>;
      `,
    });
    const result = await createDetector().detect({ root });
    expect(result.primary.i18nLibrary?.id).toBe("lingui");
  });

  it("detects next-i18next from config file", async () => {
    const root = await fixture({
      "package.json": pkg({
        dependencies: {
          next: "14.0.0",
          react: "18.0.0",
          "next-i18next": "15.0.0",
        },
      }),
      "next-i18next.config.js": "module.exports = { i18n: { defaultLocale: 'en', locales: ['en'] } };\n",
      "pages/_app.js": `import { appWithTranslation } from 'next-i18next'; const App = ({ Component, pageProps }) => <Component {...pageProps} />; export default appWithTranslation(App);`,
    });
    const result = await createDetector().detect({ root });
    expect(result.primary.i18nLibrary?.id).toBe("next-i18next");
  });
});

describe("edge cases", () => {
  it("reports unknowns for empty projects without throwing", async () => {
    const root = await fixture({});
    const result = await createDetector().detect({ root });
    expect(result.unknowns.length).toBeGreaterThan(0);
    expect(result.primary.framework).toBeUndefined();
    expect(result.primary.i18nLibrary).toBeUndefined();
  });

  it("handles corrupted package.json without throwing", async () => {
    const root = await fixture({
      "package.json": "{ this is not json !!!",
      "src/index.js": "console.log(1);\n",
    });
    const result = await createDetector().detect({ root });
    expect(
      result.warnings.some((w) => w.code === "package-json-invalid"),
    ).toBe(true);
    expect(result.languages.some((l) => l.id === "javascript")).toBe(true);
  });

  it("handles missing configuration files via dependencies alone", async () => {
    const root = await fixture({
      "package.json": pkg({
        dependencies: {
          next: "15.0.0",
          react: "19.0.0",
          "next-intl": "3.0.0",
        },
      }),
      "src/page.tsx": `import { useTranslations } from 'next-intl'; export const Page = () => { useTranslations(); return null; };`,
    });
    const result = await createDetector().detect({ root });
    expect(result.frameworks.some((f) => f.id === "nextjs")).toBe(true);
    expect(result.i18nLibraries.some((l) => l.id === "next-intl")).toBe(true);
  });

  it("detects mixed JS/TS projects", async () => {
    const root = await fixture({
      "package.json": pkg({
        dependencies: { react: "18.0.0" },
        devDependencies: { typescript: "5.0.0" },
      }),
      "tsconfig.json": JSON.stringify({ compilerOptions: {} }),
      "src/a.ts": "export const a = 1;\n",
      "src/b.js": "export const b = 2;\n",
    });
    const result = await createDetector().detect({ root });
    expect(result.primary.language?.id).toBe("mixed");
    expect(result.languages.some((l) => l.id === "typescript")).toBe(true);
    expect(result.languages.some((l) => l.id === "javascript")).toBe(true);
  });

  it("does not treat generic i18n.ts alone as a library", async () => {
    const root = await fixture({
      "package.json": pkg({ dependencies: { react: "18.0.0" } }),
      "src/i18n.ts": "export const locales = ['en'];\n",
    });
    const result = await createDetector().detect({ root });
    expect(result.i18nLibraries.length).toBe(0);
    expect(
      result.unknowns.some((u) => u.category === "i18n-library"),
    ).toBe(true);
  });

  it("does not treat messages/ alone as next-intl", async () => {
    const root = await fixture({
      "package.json": pkg({ dependencies: { react: "18.0.0" } }),
      "messages/en.json": JSON.stringify({ hello: "Hello" }),
    });
    const result = await createDetector().detect({ root });
    expect(result.i18nLibraries.some((l) => l.id === "next-intl")).toBe(false);
  });

  it("never throws when root does not exist", async () => {
    const result = await createDetector().detect({
      root: "/tmp/i18n-unused-does-not-exist-" + Date.now(),
    });
    expect(result.unknowns.length).toBeGreaterThan(0);
    expect(result.primary.framework).toBeUndefined();
  });

  it("supports scanImports:false", async () => {
    const root = await fixture({
      "package.json": pkg({
        dependencies: { vue: "3.5.0", "vue-i18n": "9.0.0" },
      }),
    });
    const result = await createDetector().detect({ root, scanImports: false });
    expect(result.primary.framework?.id).toBe("vue");
    expect(result.primary.i18nLibrary?.id).toBe("vue-i18n");
  });
});
