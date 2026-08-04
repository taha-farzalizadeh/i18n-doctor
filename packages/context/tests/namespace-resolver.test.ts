import { describe, expect, it } from "vitest";
import { createNamespaceResolver, mergeConfigs } from "../src/index.js";
import { project } from "./helpers.js";

describe("NamespaceResolver unit", () => {
  const resolver = createNamespaceResolver();

  it("prefers options.ns over call-site", () => {
    const settings = mergeConfigs([]);
    const r = resolver.resolve(
      {
        key: "x",
        absolutePath: "/a",
        relativePath: "a",
        location: {
          line: 1,
          column: 1,
          endLine: 1,
          endColumn: 1,
          start: 0,
          end: 1,
        },
        callSiteNamespace: "auth",
        optionsNamespace: "billing",
        library: "react-i18next",
      },
      settings,
    );
    expect(r.namespace).toBe("billing");
    expect(r.resolutionSource).toBe("options");
  });

  it("folds next-intl nested path into resolvedKey", () => {
    const settings = mergeConfigs([]);
    const r = resolver.resolve(
      {
        key: "title",
        absolutePath: "/a",
        relativePath: "a",
        location: {
          line: 1,
          column: 1,
          endLine: 1,
          endColumn: 1,
          start: 0,
          end: 1,
        },
        callSiteNamespace: "Dashboard",
        keyPrefix: "header",
        library: "next-intl",
      },
      settings,
    );
    expect(r.resolvedKey).toBe("Dashboard.header.title");
    expect(r.namespace).toBe("Dashboard");
  });
});

describe("NamespaceResolver via analyzer", () => {
  it("resolves useTranslation call-site namespace", () => {
    const { resolve } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n.ts": `
        import i18n from 'i18next';
        i18n.init({ defaultNS: 'common', lng: 'en' });
      `,
    });

    const r = resolve({
      key: "login.title",
      callSiteNamespace: "auth",
      library: "react-i18next",
    });
    expect(r.namespace).toBe("auth");
    expect(r.resolvedKey).toBe("login.title");
    expect(r.resolutionSource).toBe("call-site");
  });
});
