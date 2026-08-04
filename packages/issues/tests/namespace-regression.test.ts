/**
 * End-to-end Phase 013.5 regression fixtures (sources → usages → issues).
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSourceDetector } from "@i18n-doctor/sources";
import { createUsageDetector } from "@i18n-doctor/usages";
import {
  createIssueEngine,
  definitionsFromCatalog,
  usagesFromCatalog,
} from "../src/index.js";
import { fixture } from "./helpers.js";

async function analyze(root: string, options: {
  defaultNS?: string;
  fallbackNS?: readonly string[];
} = {}) {
  const [sources, usages] = await Promise.all([
    createSourceDetector().discover({ root, useDetection: false }),
    createUsageDetector().detect({ root, useDetection: false, minConfidence: 0.3 }),
  ]);
  const result = createIssueEngine().analyze({
    root,
    definitions: definitionsFromCatalog(sources),
    usages: usagesFromCatalog(usages),
    options: {
      ...(options.defaultNS !== undefined ? { defaultNS: options.defaultNS } : {}),
      ...(options.fallbackNS !== undefined
        ? { fallbackNS: options.fallbackNS }
        : {}),
    },
  });
  return { sources, usages, result };
}

describe("namespace regression fixtures", () => {
  it("home:SAVE used and settings:SAVE unused (same leaf key)", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { i18next: "23.0.0", "react-i18next": "14.0.0" },
      }),
      "locales/en/home.ts": `export default { SAVE: "Save home", TITLE: "Home" };`,
      "locales/en/settings.ts": `export default { SAVE: "Save settings", TITLE: "Settings" };`,
      "src/i18n.ts": `
        import i18next from "i18next";
        import home from "../locales/en/home";
        import settings from "../locales/en/settings";
        i18next.addResourceBundle("en", "home", home);
        i18next.addResourceBundle("en", "settings", settings);
      `,
      "src/App.tsx": `
        import { useTranslation } from "react-i18next";
        export function App() {
          const { t } = useTranslation("home");
          return t("SAVE");
        }
      `,
    });

    const { sources, result } = await analyze(root);

    expect(sources.namespaces.sort()).toEqual(["home", "settings"]);
    expect(
      sources.keys.some((k) => k.fullKey === "en::home::SAVE"),
    ).toBe(true);
    expect(
      sources.keys.some((k) => k.fullKey === "en::settings::SAVE"),
    ).toBe(true);

    expect(result.stats.duplicateKey).toBe(0);
    expect(result.stats.unusedKey).toBe(3); // home:TITLE, settings:SAVE, settings:TITLE
    const unused = result.issues.filter((i) => i.type === "unused-key");
    expect(
      unused.some(
        (i) => i.key === "SAVE" && i.source.namespace === "settings",
      ),
    ).toBe(true);
    expect(
      unused.some((i) => i.key === "SAVE" && i.source.namespace === "home"),
    ).toBe(false);
    expect(
      unused.find((i) => i.key === "SAVE" && i.source.namespace === "settings")
        ?.location.relativePath,
    ).toBe("locales/en/settings.ts");
  });

  it("detects profile namespace from addResourceBundle", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { i18next: "23.0.0" },
      }),
      "src/profile/en.js": `export default { NAME: "Name", SAVE: "Save" };`,
      "src/boot.ts": `
        import i18n from "i18next";
        import profile from "./profile/en.js";
        i18n.addResourceBundle("en", "profile", profile);
      `,
    });

    const { sources } = await analyze(root);
    expect(sources.namespaces).toContain("profile");
    expect(
      sources.keys.filter((k) => k.namespace === "profile").map((k) => k.key).sort(),
    ).toEqual(["NAME", "SAVE"]);
  });

  it("t(key, { ns }) overrides useTranslation namespace", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0", i18next: "23.0.0" },
      }),
      "locales/en/home.ts": `export default { SAVE: "H" };`,
      "locales/en/settings.ts": `export default { SAVE: "S" };`,
      "src/reg.ts": `
        import i18next from "i18next";
        import home from "../locales/en/home";
        import settings from "../locales/en/settings";
        i18next.addResourceBundle("en", "home", home);
        i18next.addResourceBundle("en", "settings", settings);
      `,
      "src/App.tsx": `
        import { useTranslation } from "react-i18next";
        export function App() {
          const { t } = useTranslation("home");
          return t("SAVE", { ns: "settings" });
        }
      `,
    });

    const { result } = await analyze(root);
    const unused = result.issues.filter((i) => i.type === "unused-key");
    expect(
      unused.some((i) => i.key === "SAVE" && i.source.namespace === "settings"),
    ).toBe(false);
    expect(
      unused.some((i) => i.key === "SAVE" && i.source.namespace === "home"),
    ).toBe(true);
  });

  it("useTranslation multi-ns + keyPrefix + renamed alias", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0", i18next: "23.0.0" },
      }),
      "locales/en/home.ts": `export default { "form.SAVE": "Save", OTHER: "x" };`,
      "locales/en/settings.ts": `export default { "form.SAVE": "Save", OTHER: "y" };`,
      "src/reg.ts": `
        import i18next from "i18next";
        import home from "../locales/en/home";
        import settings from "../locales/en/settings";
        i18next.addResourceBundle("en", "home", home);
        i18next.addResourceBundle("en", "settings", settings);
      `,
      "src/App.tsx": `
        import { useTranslation } from "react-i18next";
        export function App() {
          const { t: translate } = useTranslation(["home", "settings"], { keyPrefix: "form" });
          return translate("SAVE");
        }
      `,
    });

    const { usages, result } = await analyze(root);
    const u = usages.usages.find((x) => x.key === "form.SAVE");
    expect(u?.namespace).toBe("home");
    expect(u?.namespaces).toEqual(["home", "settings"]);
    expect(result.stats.unusedKey).toBe(2); // home:OTHER, settings:OTHER
    expect(result.stats.missingKey).toBe(0);
  });

  it("defaultNS resolves bare t() without call-site namespace", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { i18next: "23.0.0", "react-i18next": "14.0.0" },
      }),
      "src/i18n.ts": `
        import i18n from "i18next";
        i18n.init({
          defaultNS: "common",
          resources: {
            en: { common: { SAVE: "Save" }, orphan: { SAVE: "Orphan" } },
          },
        });
      `,
      "src/App.tsx": `
        import { useTranslation } from "react-i18next";
        export function App() {
          const { t } = useTranslation();
          return t("SAVE");
        }
      `,
    });

    const { result } = await analyze(root, { defaultNS: "common" });
    expect(
      result.issues.some(
        (i) => i.type === "unused-key" && i.source.namespace === "common",
      ),
    ).toBe(false);
    expect(
      result.issues.some(
        (i) =>
          i.type === "unused-key" &&
          i.key === "SAVE" &&
          i.source.namespace === "orphan",
      ),
    ).toBe(true);
  });

  it("createInstance resources are namespaced; common/home/settings SAVE not duplicates", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { i18next: "23.0.0" },
      }),
      "src/i18n.ts": `
        import i18next from "i18next";
        const instance = i18next.createInstance({
          resources: {
            en: {
              home: { SAVE: "H" },
              settings: { SAVE: "S" },
              common: { SAVE: "C" },
            },
          },
        });
        void instance;
      `,
    });

    const { sources, result } = await analyze(root);
    expect(sources.namespaces.sort()).toEqual(["common", "home", "settings"]);
    expect(result.stats.duplicateKey).toBe(0);
    expect(result.stats.unusedKey).toBe(3);
  });

  it("addResource single key + duplicate registration is idempotent", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { i18next: "23.0.0" },
      }),
      "src/boot.ts": `
        import i18n from "i18next";
        i18n.addResource("en", "tips", "HINT", "Hello");
        i18n.addResource("en", "tips", "HINT", "Hello");
      `,
    });

    const { sources, result } = await analyze(root);
    const hints = sources.keys.filter(
      (k) => k.namespace === "tips" && k.key === "HINT",
    );
    expect(hints.length).toBeGreaterThanOrEqual(1);
    expect(result.stats.duplicateKey).toBe(0);
  });

  it("dynamic/variable namespace is unresolved (no false attribution)", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { i18next: "23.0.0" },
      }),
      // parent stem "i18n" is ignored → no path-inferred namespace
      "src/i18n/en.ts": `export default { SAVE: "Save" };`,
      "src/boot.ts": `
        import i18n from "i18next";
        import en from "./i18n/en";
        const ns = "home";
        i18n.addResourceBundle("en", ns, en);
      `,
    });

    const { sources } = await analyze(root);
    const save = sources.keys.find((k) => k.key === "SAVE");
    expect(save?.namespace).toBeUndefined();
    expect(
      sources.warnings.some((w) => w.code === "unresolved-resource-registration"),
    ).toBe(true);
  });

  it("monorepo package scopes keep independent namespaces", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({ private: true, workspaces: ["packages/*"] }),
      "packages/web/package.json": JSON.stringify({
        name: "web",
        dependencies: { i18next: "23.0.0" },
      }),
      "packages/web/src/i18n.ts": `
        import i18next from "i18next";
        i18next.init({
          resources: { en: { web: { SAVE: "Web" } } },
        });
      `,
      "packages/api/package.json": JSON.stringify({
        name: "api",
        dependencies: { i18next: "23.0.0" },
      }),
      "packages/api/src/i18n.ts": `
        import i18next from "i18next";
        i18next.init({
          resources: { en: { api: { SAVE: "Api" } } },
        });
      `,
    });

    const web = await createSourceDetector().discover({
      root: path.join(root, "packages/web"),
      useDetection: false,
    });
    const api = await createSourceDetector().discover({
      root: path.join(root, "packages/api"),
      useDetection: false,
    });
    expect(web.namespaces).toEqual(["web"]);
    expect(api.namespaces).toEqual(["api"]);
  });

  it("ordering of unused issues is deterministic", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { i18next: "23.0.0" },
      }),
      "src/i18n.ts": `
        export const resources = {
          en: {
            a: { Z: "z", A: "a" },
            b: { Z: "z", A: "a" },
          },
        };
      `,
    });

    const first = await analyze(root);
    const second = await analyze(root);
    expect(
      first.result.issues.map((i) => `${i.type}:${i.source.namespace}:${i.key}`),
    ).toEqual(
      second.result.issues.map((i) => `${i.type}:${i.source.namespace}:${i.key}`),
    );
  });
});
