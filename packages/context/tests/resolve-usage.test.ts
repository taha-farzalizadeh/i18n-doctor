import { describe, expect, it } from "vitest";
import { project } from "./helpers.js";

describe("resolveUsage", () => {
  it("returns original key, resolved key, namespace, locale, sources", () => {
    const { resolve } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n.ts": `
        import i18n from 'i18next';
        i18n.init({
          lng: 'en',
          fallbackLng: 'en',
          defaultNS: 'common',
          fallbackNS: 'fallback',
          ns: ['common', 'auth'],
        });
      `,
    });

    const r = resolve({
      key: "title",
      callSiteNamespace: "auth",
      keyPrefix: "login",
      library: "react-i18next",
    });

    expect(r.originalKey).toBe("title");
    expect(r.resolvedKey).toBe("login.title");
    expect(r.namespace).toBe("auth");
    expect(r.locale).toBe("en");
    expect(r.fallbackLocale).toEqual(["en"]);
    expect(r.resolutionSource).toBe("call-site");
    expect(r.resolutionChain).toContain("key-prefix");
    expect(r.resolutionChain).toContain("fallbackNS");
    expect(r.confidence).toBeGreaterThan(0.5);
    expect(r.evidence).toContain("namespace=auth");
  });

  it("supports monorepo package roots", () => {
    const { analyzer } = project({
      "package.json": JSON.stringify({
        name: "root",
        workspaces: ["packages/*"],
      }),
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
    expect(contexts.length).toBeGreaterThanOrEqual(2);

    const web = contexts.find((c) =>
      (c.packageRoot ?? c.root).includes("packages/web"),
    );
    const api = contexts.find((c) =>
      (c.packageRoot ?? c.root).includes("packages/api"),
    );

    expect(web?.effective.defaultNS).toBe("web");
    expect(api?.effective.defaultNS).toBe("api");
    expect(api?.effective.defaultLocale).toBe("fr");
  });
});
