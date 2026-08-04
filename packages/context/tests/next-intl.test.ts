import { describe, expect, it } from "vitest";
import { project } from "./helpers.js";

describe("next-intl namespace resolution", () => {
  const fixture = () =>
    project({
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { "next-intl": "3.0.0" },
      }),
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

  it("resolves useTranslations() without namespace", () => {
    const { resolve } = fixture();
    const r = resolve({
      key: "Home.title",
      library: "next-intl",
    });
    expect(r.resolvedKey).toBe("Home.title");
    expect(r.namespace).toBeUndefined();
    expect(r.namespaces).toBeUndefined();
    expect(r.locale).toBe("en");
    // Namespace stayed unset (no i18next defaultNS bleed); locale may resolve
    expect(r.evidence).not.toContain("namespace=common");
  });

  it("resolves useTranslations(\"Dashboard\") as nested message path", () => {
    const { resolve } = fixture();
    const r = resolve({
      key: "title",
      callSiteNamespace: "Dashboard",
      library: "next-intl",
    });
    expect(r.namespace).toBe("Dashboard");
    expect(r.resolvedKey).toBe("Dashboard.title");
    expect(r.resolutionSource).toBe("call-site");
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("resolves nested namespaces useTranslations(\"Dashboard.Chart\")", () => {
    const { resolve } = fixture();
    const r = resolve({
      key: "label",
      callSiteNamespace: "Dashboard.Chart",
      library: "next-intl",
    });
    expect(r.namespace).toBe("Dashboard.Chart");
    expect(r.resolvedKey).toBe("Dashboard.Chart.label");
  });

  it("nests keyPrefix under messages namespace", () => {
    const { resolve } = fixture();
    const r = resolve({
      key: "title",
      callSiteNamespace: "Dashboard",
      keyPrefix: "header",
      library: "next-intl",
    });
    expect(r.resolvedKey).toBe("Dashboard.header.title");
    expect(r.keyPrefix).toBe("header");
    expect(r.resolutionChain).toEqual(
      expect.arrayContaining(["call-site", "key-prefix"]),
    );
  });

  it("does not apply i18next defaultNS / fallbackNS to next-intl", () => {
    const { resolve } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n.ts": `
        import i18n from 'i18next';
        i18n.init({ defaultNS: 'common', fallbackNS: 'fb', lng: 'en' });
      `,
      "i18n/routing.ts": `
        import { defineRouting } from 'next-intl/routing';
        export const locales = ['en'];
        export const defaultLocale = 'en';
        export const routing = defineRouting({ locales, defaultLocale });
      `,
    });
    const r = resolve({
      key: "hello",
      library: "next-intl",
    });
    expect(r.namespace).toBeUndefined();
    expect(r.namespaces).toBeUndefined();
    expect(r.resolvedKey).toBe("hello");
  });

  it("does not split inline ns:key for next-intl", () => {
    const { resolve } = fixture();
    const r = resolve({
      key: "auth:login.title",
      library: "next-intl",
    });
    expect(r.resolvedKey).toBe("auth:login.title");
    expect(r.namespace).toBeUndefined();
  });

  it("parses getRequestConfig returned object", () => {
    const { analyzer } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n/request.ts": `
        import { getRequestConfig } from 'next-intl/server';
        export default getRequestConfig(async () => {
          return {
            locale: 'de',
            messages: {},
          };
        });
      `,
    });
    const ctx = analyzer.analyze();
    expect(ctx.effective.defaultLocale).toBe("de");
  });
});
