import { describe, expect, it } from "vitest";
import { project } from "./helpers.js";

describe("edge cases", () => {
  it("handles missing namespace (implicit translation for i18next)", () => {
    const { resolve } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n.ts": `
        import i18n from 'i18next';
        i18n.init({ lng: 'en' });
      `,
    });
    const r = resolve({ key: "hello", library: "react-i18next" });
    expect(r.namespace).toBe("translation");
    expect(r.resolvedKey).toBe("hello");
  });

  it("deduplicates duplicate namespaces", () => {
    const { resolve } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n.ts": `
        import i18n from 'i18next';
        i18n.init({ defaultNS: 'common', fallbackNS: 'common' });
      `,
    });
    const r = resolve({
      key: "x",
      callSiteNamespace: ["auth", "auth", "common"],
      library: "react-i18next",
    });
    expect(r.namespace).toBe("auth");
    expect(r.namespaces).toEqual(["auth", "common"]);
  });

  it("lowers confidence for unknown locale vs supportedLocales", () => {
    const { analyzer, usage } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n.ts": `
        import i18n from 'i18next';
        i18n.init({
          lng: 'en',
          supportedLngs: ['en', 'de'],
        });
      `,
    });
    analyzer.analyze();
    const known = analyzer.resolveLocale(usage({ key: "a", locale: "en" }));
    const unknown = analyzer.resolveLocale(usage({ key: "a", locale: "xx" }));
    expect(known.confidence).toBeGreaterThan(unknown.confidence);
    expect(unknown.locale).toBe("xx");
    expect(unknown.supportedLocales).toEqual(["en", "de"]);
  });

  it("handles invalid config without throwing", () => {
    const { analyzer, resolve } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n.ts": `
        import i18n from 'i18next';
        this is not valid javascript {{{@@@
        i18n.init({ defaultNS: 'common', lng: 'en' });
      `,
    });
    expect(() => analyzer.analyze()).not.toThrow();
    const ctx = analyzer.analyze();
    // May or may not extract depending on parser recovery — must stay safe
    expect(ctx.warnings).toBeDefined();
    const r = resolve({
      key: "hi",
      callSiteNamespace: "auth",
      library: "react-i18next",
    });
    expect(r.namespace).toBe("auth");
  });

  it("does not execute dynamic config values", () => {
    const { analyzer } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n.ts": `
        import i18n from 'i18next';
        const ns = process.env.NS;
        i18n.init({
          defaultNS: ns,
          lng: getLocale(),
          ns: loadNamespaces(),
        });
        function getLocale() { return 'en'; }
        function loadNamespaces() { return ['a']; }
      `,
    });
    const ctx = analyzer.analyze();
    expect(ctx.effective.defaultNS).toBeUndefined();
    expect(ctx.effective.defaultLocale).toBeUndefined();
  });

  it("resolves file-local const aliases in config", () => {
    const { analyzer } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n.ts": `
        import i18n from 'i18next';
        const DEFAULT_NS = 'common';
        const LANG = 'en';
        i18n.init({
          defaultNS: DEFAULT_NS,
          lng: LANG,
        });
      `,
    });
    const ctx = analyzer.analyze();
    expect(ctx.effective.defaultNS).toBe("common");
    expect(ctx.effective.defaultLocale).toBe("en");
  });

  it("supports monorepo with per-package + shared root configs", () => {
    const { analyzer } = project({
      "package.json": JSON.stringify({
        name: "root",
        workspaces: ["packages/*"],
      }),
      "i18n.ts": `
        import i18n from 'i18next';
        i18n.init({
          fallbackLng: 'en',
          supportedLngs: ['en', 'de'],
        });
      `,
      "packages/web/package.json": JSON.stringify({ name: "web" }),
      "packages/web/i18n.ts": `
        import i18n from 'i18next';
        i18n.init({ defaultNS: 'web', lng: 'en' });
      `,
      "packages/api/package.json": JSON.stringify({ name: "api" }),
      "packages/api/i18n.ts": `
        import i18n from 'i18next';
        i18n.init({ defaultNS: 'api', lng: 'fr' });
      `,
    });

    const contexts = analyzer.analyzeMonorepo();
    const web = contexts.find((c) =>
      (c.packageRoot ?? "").includes("packages/web"),
    );
    const api = contexts.find((c) =>
      (c.packageRoot ?? "").includes("packages/api"),
    );

    expect(web?.effective.defaultNS).toBe("web");
    expect(api?.effective.defaultNS).toBe("api");
    expect(api?.effective.defaultLocale).toBe("fr");
    // Root supportedLngs available to packages without local override
    expect(web?.effective.supportedLocales).toEqual(
      expect.arrayContaining(["en", "de"]),
    );
  });

  it("handles multiple conflicting i18n configs gracefully", () => {
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
    // Deterministic winner via library priority
    expect(ctx.effective.defaultNS).toBe("auth");
    expect(ctx.effective.defaultLocale).toBe("de");
  });

  it("walks locale inheritance chains", () => {
    const { analyzer, usage } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n.ts": `
        import i18n from 'i18next';
        i18n.init({
          lng: 'en',
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

  it("keeps stable confidence for namespace when locale unresolved", () => {
    const { resolve } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n.ts": `
        import i18n from 'i18next';
        i18n.init({ defaultNS: 'common' });
      `,
    });
    const r = resolve({
      key: "x",
      callSiteNamespace: "auth",
      library: "react-i18next",
    });
    expect(r.locale).toBeUndefined();
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("extracts namespaces from resources without using them as defaultNS", () => {
    const { analyzer, resolve } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n.ts": `
        import i18n from 'i18next';
        i18n.init({
          resources: {
            en: {
              common: { hi: 'hi' },
              auth: { login: 'login' },
            },
            de: {
              common: { hi: 'hallo' },
            },
          },
        });
      `,
    });
    const ctx = analyzer.analyze();
    expect(ctx.effective.supportedLocales).toEqual(
      expect.arrayContaining(["en", "de"]),
    );
    expect(ctx.effective.namespaces).toEqual(
      expect.arrayContaining(["auth", "common"]),
    );
    const r = resolve({ key: "hi", library: "i18next" });
    expect(r.namespace).toBe("translation");
  });
});
