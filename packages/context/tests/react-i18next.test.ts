import { describe, expect, it } from "vitest";
import { project } from "./helpers.js";

describe("react-i18next namespace resolution", () => {
  const fixture = () =>
    project({
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { "react-i18next": "15.0.0", i18next: "23.0.0" },
      }),
      "i18n.ts": `
        import i18n from 'i18next';
        i18n.init({
          lng: 'en',
          fallbackLng: 'en',
          defaultNS: 'common',
          fallbackNS: 'fallback',
          ns: ['common', 'auth', 'billing'],
          supportedLngs: ['en', 'de'],
        });
      `,
    });

  it("resolves useTranslation(\"auth\")", () => {
    const { resolve } = fixture();
    const r = resolve({
      key: "login.title",
      callSiteNamespace: "auth",
      library: "react-i18next",
    });
    expect(r.originalKey).toBe("login.title");
    expect(r.resolvedKey).toBe("login.title");
    expect(r.namespace).toBe("auth");
    expect(r.resolutionSource).toBe("call-site");
    expect(r.locale).toBe("en");
    // fallbackNS attached as secondary candidates
    expect(r.namespaces).toEqual(["auth", "fallback"]);
    expect(r.resolutionChain).toContain("fallbackNS");
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("resolves multiple namespaces useTranslation([\"auth\",\"common\"])", () => {
    const { resolve } = fixture();
    const r = resolve({
      key: "submit",
      callSiteNamespace: ["auth", "common"],
      library: "react-i18next",
    });
    expect(r.namespace).toBe("auth");
    expect(r.namespaces).toEqual(["auth", "common", "fallback"]);
    expect(r.resolvedKey).toBe("submit");
  });

  it("applies keyPrefix from useTranslation options", () => {
    const { resolve } = fixture();
    const r = resolve({
      key: "title",
      callSiteNamespace: "auth",
      keyPrefix: "login",
      library: "react-i18next",
    });
    expect(r.namespace).toBe("auth");
    expect(r.resolvedKey).toBe("login.title");
    expect(r.keyPrefix).toBe("login");
    expect(r.resolutionChain).toContain("key-prefix");
  });

  it("prefers t(key, { ns }) options over call-site", () => {
    const { resolve } = fixture();
    const r = resolve({
      key: "amount",
      callSiteNamespace: "auth",
      optionsNamespace: "billing",
      library: "react-i18next",
    });
    expect(r.namespace).toBe("billing");
    expect(r.resolutionSource).toBe("options");
    expect(r.namespaces).toContain("fallback");
  });

  it("supports optionsNamespace as array", () => {
    const { resolve } = fixture();
    const r = resolve({
      key: "x",
      optionsNamespace: ["billing", "common"],
      library: "react-i18next",
    });
    expect(r.namespace).toBe("billing");
    expect(r.namespaces).toEqual(["billing", "common", "fallback"]);
  });

  it("falls back to defaultNS when call-site namespace missing", () => {
    const { resolve } = fixture();
    const r = resolve({
      key: "nav.home",
      library: "react-i18next",
    });
    expect(r.namespace).toBe("common");
    expect(r.resolutionSource).toBe("defaultNS");
  });

  it("uses implicit translation defaultNS when config omits defaultNS", () => {
    const { resolve } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n.ts": `
        import i18n from 'i18next';
        i18n.init({ ns: ['auth', 'common'], lng: 'en' });
      `,
    });
    const r = resolve({ key: "hi", library: "react-i18next" });
    expect(r.namespace).toBe("translation");
    expect(r.resolutionSource).toBe("defaultNS");
    expect(r.confidence).toBeLessThan(0.7);
  });

  it("splits inline ns:key when no binding namespace", () => {
    const { resolve } = fixture();
    const r = resolve({
      key: "auth:login.title",
      library: "react-i18next",
    });
    expect(r.namespace).toBe("auth");
    expect(r.resolvedKey).toBe("login.title");
  });

  it("is deterministic across repeated resolveUsage calls", () => {
    const { resolve } = fixture();
    const a = resolve({
      key: "title",
      callSiteNamespace: ["auth", "common"],
      keyPrefix: "login",
      library: "react-i18next",
    });
    const b = resolve({
      key: "title",
      callSiteNamespace: ["auth", "common"],
      keyPrefix: "login",
      library: "react-i18next",
    });
    expect(a).toEqual(b);
    expect(a.confidence).toBe(b.confidence);
  });
});
