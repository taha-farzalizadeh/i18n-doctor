import { describe, expect, it } from "vitest";
import { project } from "./helpers.js";

describe("configuration parsing", () => {
  it("extracts defaultNS, fallbackNS, supportedLngs from i18next.init", () => {
    const { analyzer } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n.ts": `
        import i18n from 'i18next';
        i18n.init({
          defaultNS: 'common',
          fallbackNS: ['fallback', 'common'],
          ns: ['common', 'auth'],
          supportedLngs: ['en', 'de', 'fr'],
          lng: 'en',
          fallbackLng: 'en',
        });
      `,
    });
    const ctx = analyzer.analyze();
    expect(ctx.effective.defaultNS).toBe("common");
    expect(ctx.effective.fallbackNS).toEqual(["fallback", "common"]);
    expect(ctx.effective.namespaces).toEqual(["common", "auth"]);
    expect(ctx.effective.supportedLocales).toEqual(["en", "de", "fr"]);
    expect(ctx.effective.defaultLocale).toBe("en");
    expect(ctx.effective.fallbackLocales).toEqual(["en"]);
  });

  it("extracts locales from next-i18next and next-intl configs", () => {
    const { analyzer } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "next-i18next.config.js": `
        module.exports = {
          i18n: {
            defaultLocale: 'en',
            locales: ['en', 'de'],
          },
          defaultNS: 'common',
        };
      `,
    });
    const ctx = analyzer.analyze();
    expect(ctx.effective.defaultLocale).toBe("en");
    expect(ctx.effective.supportedLocales).toEqual(["en", "de"]);
    expect(ctx.effective.defaultNS).toBe("common");
  });

  it("extracts locales from next.config i18n block", () => {
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
    expect(ctx.effective.defaultLocale).toBe("en-us");
    expect(ctx.effective.supportedLocales).toEqual(["en-us", "fr"]);
  });

  it("maps fallbackLng object to inheritance without polluting fallbackLocales", () => {
    const { analyzer } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n.ts": `
        import i18n from 'i18next';
        i18n.init({
          lng: 'de-CH',
          fallbackLng: {
            'de-CH': ['de', 'en'],
            'de': ['en'],
            default: ['en'],
          },
        });
      `,
    });
    const ctx = analyzer.analyze();
    expect(ctx.effective.fallbackLocales).toEqual(["en"]);
    expect(ctx.effective.localeInheritance).toEqual({
      "de-ch": "de",
      de: "en",
    });
    expect(ctx.effective.localeInheritance?.default).toBeUndefined();
  });

  it("respects nsSeparator: false", () => {
    const { resolve } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n.ts": `
        import i18n from 'i18next';
        i18n.init({
          defaultNS: 'common',
          nsSeparator: false,
          keySeparator: '.',
        });
      `,
    });
    const r = resolve({
      key: "auth:login.title",
      library: "i18next",
    });
    // Inline split disabled
    expect(r.namespace).toBe("common");
    expect(r.resolvedKey).toBe("auth:login.title");
  });
});
