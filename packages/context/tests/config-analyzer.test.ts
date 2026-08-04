import { describe, expect, it } from "vitest";
import { project } from "./helpers.js";

describe("ConfigAnalyzer", () => {
  it("parses i18next.init() defaultNS, ns, locales", () => {
    const { analyzer } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "src/i18n.ts": `
        import i18n from 'i18next';
        i18n.init({
          lng: 'en',
          fallbackLng: 'en',
          defaultNS: 'common',
          fallbackNS: 'fallback',
          ns: ['common', 'auth'],
          supportedLngs: ['en', 'de'],
        });
      `,
    });

    const ctx = analyzer.analyze();
    expect(ctx.configs.length).toBeGreaterThan(0);
    const init = ctx.configs.find((c) => c.kind === "i18next-init");
    expect(init).toBeDefined();
    expect(init!.defaultNS).toBe("common");
    expect(init!.ns).toEqual(["common", "auth"]);
    expect(init!.defaultLocale).toBe("en");
    expect(init!.supportedLocales).toEqual(["en", "de"]);
    expect(ctx.effective.defaultNS).toBe("common");
    expect(ctx.effective.defaultLocale).toBe("en");
  });

  it("parses i18next.createInstance()", () => {
    const { analyzer } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n.ts": `
        import i18next from 'i18next';
        const instance = i18next.createInstance({
          defaultNS: 'app',
          lng: 'fr',
        });
      `,
    });

    const ctx = analyzer.analyze();
    const created = ctx.configs.find((c) => c.kind === "i18next-create-instance");
    expect(created).toBeDefined();
    expect(created!.defaultNS).toBe("app");
    expect(created!.defaultLocale).toBe("fr");
  });

  it("parses chained i18n.use().init()", () => {
    const { analyzer } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n.js": `
        import i18n from 'i18next';
        import { initReactI18next } from 'react-i18next';
        i18n.use(initReactI18next).init({
          defaultNS: 'translation',
          lng: 'en',
        });
      `,
    });

    const ctx = analyzer.analyze();
    expect(ctx.effective.defaultNS).toBe("translation");
  });

  it("parses next-i18next.config.js", () => {
    const { analyzer } = project({
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { "next-i18next": "15.0.0" },
      }),
      "next-i18next.config.js": `
        module.exports = {
          i18n: {
            defaultLocale: 'en',
            locales: ['en', 'de', 'fr'],
          },
          defaultNS: 'common',
          ns: ['common', 'auth'],
          fallbackLng: {
            'de-CH': ['de', 'en'],
            default: ['en'],
          },
        };
      `,
    });

    const ctx = analyzer.analyze();
    const cfg = ctx.configs.find((c) => c.kind === "next-i18next");
    expect(cfg).toBeDefined();
    expect(cfg!.defaultLocale).toBe("en");
    expect(cfg!.supportedLocales).toEqual(["en", "de", "fr"]);
    expect(cfg!.defaultNS).toBe("common");
    expect(cfg!.localeInheritance?.["de-ch"]).toBe("de");
    expect(ctx.effective.fallbackLocales).toEqual(["en"]);
  });

  it("parses next-intl defineRouting + named exports", () => {
    const { analyzer } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n/routing.ts": `
        import { defineRouting } from 'next-intl/routing';
        export const locales = ['en', 'de'] as const;
        export const defaultLocale = 'en';
        export const routing = defineRouting({
          locales,
          defaultLocale,
        });
      `,
    });

    const ctx = analyzer.analyze();
    expect(ctx.effective.defaultLocale).toBe("en");
    expect(ctx.effective.supportedLocales).toEqual(
      expect.arrayContaining(["en", "de"]),
    );
  });

  it("parses next.config.js i18n block", () => {
    const { analyzer } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "next.config.js": `
        module.exports = {
          i18n: {
            defaultLocale: 'en-US',
            locales: ['en-US', 'fr'],
          },
        };
      `,
    });

    const ctx = analyzer.analyze();
    const cfg = ctx.configs.find((c) => c.kind === "next-config");
    expect(cfg).toBeDefined();
    expect(cfg!.defaultLocale).toBe("en-us");
    expect(cfg!.supportedLocales).toEqual(["en-us", "fr"]);
  });

  it("parses vue-i18n createI18n()", () => {
    const { analyzer } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "src/i18n.ts": `
        import { createI18n } from 'vue-i18n';
        export default createI18n({
          locale: 'en',
          fallbackLocale: 'en',
          messages: {
            en: { hello: 'hi' },
            ja: { hello: 'こんにちは' },
          },
        });
      `,
    });

    const ctx = analyzer.analyze();
    const cfg = ctx.configs.find((c) => c.kind === "vue-i18n");
    expect(cfg).toBeDefined();
    expect(cfg!.defaultLocale).toBe("en");
    expect(cfg!.supportedLocales).toEqual(["en", "ja"]);
  });

  it("caches configuration analysis", () => {
    const { analyzer } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n.ts": `
        import i18n from 'i18next';
        i18n.init({ defaultNS: 'common', lng: 'en' });
      `,
    });

    const a = analyzer.analyze();
    const b = analyzer.analyze();
    expect(a).toBe(b);
    analyzer.clearCache();
    const c = analyzer.analyze();
    expect(c).not.toBe(a);
    expect(c.effective.defaultNS).toBe("common");
  });

  it("handles conflicting configs gracefully", () => {
    const { analyzer } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n.ts": `
        import i18n from 'i18next';
        i18n.init({ defaultNS: 'common', lng: 'en' });
      `,
      "next-i18next.config.js": `
        module.exports = {
          i18n: { defaultLocale: 'de', locales: ['de'] },
          defaultNS: 'auth',
        };
      `,
    });

    const ctx = analyzer.analyze();
    expect(ctx.effective.conflicts.length).toBeGreaterThan(0);
    expect(ctx.warnings.some((w) => w.code === "config-conflict")).toBe(true);
    expect(ctx.effective.defaultNS).toBe("auth");
  });
});
