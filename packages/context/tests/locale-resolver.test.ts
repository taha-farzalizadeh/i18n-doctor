import { describe, expect, it } from "vitest";
import { project } from "./helpers.js";

describe("LocaleResolver", () => {
  it("uses default locale from config", () => {
    const { analyzer, usage } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "next-i18next.config.js": `
        module.exports = {
          i18n: { defaultLocale: 'de', locales: ['de', 'en'] },
        };
      `,
    });

    const ctx = analyzer.analyze();
    const loc = analyzer.resolveLocale(usage({ key: "a" }), { context: ctx });
    expect(loc.locale).toBe("de");
    expect(loc.supportedLocales).toEqual(["de", "en"]);
    expect(loc.resolutionSource).toBe("default-locale");
  });

  it("walks locale inheritance", () => {
    const { analyzer, usage } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n.ts": `
        import i18n from 'i18next';
        i18n.init({
          lng: 'de-ch',
          fallbackLng: {
            'de-CH': ['de', 'en'],
            'de': ['en'],
            default: ['en'],
          },
        });
      `,
    });

    const ctx = analyzer.analyze();
    const loc = analyzer.resolveLocale(
      usage({ key: "a", locale: "de-CH" }),
      { context: ctx },
    );
    expect(loc.locale).toBe("de-ch");
    expect(loc.inheritanceChain).toEqual(["de-ch", "de", "en"]);
    expect(loc.resolutionChain).toContain("locale-inheritance");
  });

  it("prefers explicit usage locale over default", () => {
    const { analyzer, usage } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n.ts": `
        import i18n from 'i18next';
        i18n.init({ lng: 'en', fallbackLng: 'en' });
      `,
    });

    analyzer.analyze();
    const loc = analyzer.resolveLocale(usage({ key: "a", locale: "fr" }));
    expect(loc.locale).toBe("fr");
    expect(loc.resolutionSource).toBe("call-site");
  });
});
