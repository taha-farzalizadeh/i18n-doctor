import { describe, expect, it } from "vitest";
import {
  buildFullKey,
  createSourceDetector,
  toTranslationEntry,
} from "../src/index.js";
import { fixture } from "./helpers.js";

describe("i18next resource registration (Phase 013.5)", () => {
  it("attributes namespace from addResourceBundle + relative import", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { i18next: "23.0.0", "react-i18next": "14.0.0" },
      }),
      "src/home/i18n/en.ts": `
        export default {
          SAVE: "Save",
          TITLE: "Home",
        };
      `,
      "src/home/Home.tsx": `
        import i18next from "i18next";
        import en from "./i18n/en";
        i18next.addResourceBundle("en", "home", en);
      `,
    });

    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });

    const save = catalog.keys.find((k) => k.key === "SAVE");
    expect(save?.namespace).toBe("home");
    expect(save?.locale).toBe("en");
    expect(save?.fullKey).toBe("en::home::SAVE");
    expect(catalog.namespaces).toContain("home");

    const entry = toTranslationEntry(save!);
    expect(entry).toMatchObject({
      locale: "en",
      namespace: "home",
      keyPath: "SAVE",
      fullKey: "en::home::SAVE",
    });
  });

  it("attributes namespace via tsconfig paths aliases", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { i18next: "23.0.0" },
      }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          paths: { "app/*": ["./src/app/*"] },
        },
      }),
      "src/app/pages/home/i18n/en.ts": `
        export default { SAVE: "Save", CANCEL: "Cancel" };
      `,
      "src/app/pages/home/Home.tsx": `
        import i18next from "i18next";
        import en from "app/pages/home/i18n/en";
        i18next.addResourceBundle("en", "home", en);
      `,
      "src/app/pages/settings/i18n/en.ts": `
        export default { SAVE: "Save settings" };
      `,
      "src/app/pages/settings/Settings.tsx": `
        import i18next from "i18next";
        import en from "app/pages/settings/i18n/en";
        i18next.addResourceBundle("en", "settings", en);
      `,
    });

    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });

    const saves = catalog.keys.filter((k) => k.key === "SAVE" && k.locale === "en");
    expect(saves.map((k) => k.namespace).sort()).toEqual(["home", "settings"]);
    expect(saves.every((k) => k.fullKey?.includes(`::${k.namespace}::SAVE`))).toBe(
      true,
    );
  });

  it("extracts inline addResourceBundle and addResource", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { i18next: "23.0.0" },
      }),
      "src/boot.ts": `
        import i18n from "i18next";
        i18n.addResourceBundle("en", "inline", { HELLO: "Hello" });
        i18n.addResource("en", "inline", "BYE", "Bye");
      `,
    });

    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });

    expect(
      catalog.keys.some(
        (k) => k.key === "HELLO" && k.namespace === "inline" && k.locale === "en",
      ),
    ).toBe(true);
    expect(
      catalog.keys.some(
        (k) => k.key === "BYE" && k.namespace === "inline" && k.locale === "en",
      ),
    ).toBe(true);
  });

  it("extracts createInstance / init resources maps", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { i18next: "23.0.0" },
      }),
      "src/i18n.ts": `
        import i18next from "i18next";
        i18next.init({
          resources: {
            en: {
              common: { title: "Title" },
            },
          },
        });
        const instance = i18next.createInstance({
          resources: {
            fa: {
              home: { SAVE: "ذخیره" },
            },
          },
        });
        void instance;
      `,
    });

    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });

    expect(
      catalog.keys.some(
        (k) =>
          k.key === "title" && k.namespace === "common" && k.locale === "en",
      ),
    ).toBe(true);
    expect(
      catalog.keys.some(
        (k) => k.key === "SAVE" && k.namespace === "home" && k.locale === "fa",
      ),
    ).toBe(true);
  });

  it("buildFullKey uses wildcards when locale/namespace absent", () => {
    expect(buildFullKey(undefined, undefined, "SAVE")).toBe("*::*::SAVE");
    expect(buildFullKey("en", null, "SAVE")).toBe("en::*::SAVE");
  });

  it("duplicate addResourceBundle registrations are idempotent", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { i18next: "23.0.0" },
      }),
      "src/i18n/en.ts": `export default { SAVE: "Save" };`,
      "src/a.tsx": `
        import i18next from "i18next";
        import en from "./i18n/en";
        i18next.addResourceBundle("en", "home", en);
      `,
      "src/b.tsx": `
        import i18next from "i18next";
        import en from "./i18n/en";
        i18next.addResourceBundle("en", "home", en);
      `,
    });

    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });
    const saves = catalog.keys.filter(
      (k) => k.key === "SAVE" && k.namespace === "home" && k.locale === "en",
    );
    expect(saves).toHaveLength(1);
    expect(saves[0]?.fullKey).toBe("en::home::SAVE");
  });

  it("warns on conflicting namespace registrations for one file", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { i18next: "23.0.0" },
      }),
      "src/i18n/en.ts": `export default { SAVE: "Save" };`,
      "src/a.tsx": `
        import i18next from "i18next";
        import en from "./i18n/en";
        i18next.addResourceBundle("en", "home", en);
      `,
      "src/b.tsx": `
        import i18next from "i18next";
        import en from "./i18n/en";
        i18next.addResourceBundle("en", "settings", en);
      `,
    });

    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });
    expect(
      catalog.warnings.some((w) => w.code === "conflicting-resource-registration"),
    ).toBe(true);
    // First registration wins (deterministic by path sort: a.tsx before b.tsx)
    expect(
      catalog.keys.find((k) => k.key === "SAVE")?.namespace,
    ).toBe("home");
  });

  it("supports large locale catalogs without exploding namespaces", async () => {
    const keys = Object.fromEntries(
      Array.from({ length: 200 }, (_, i) => [`KEY_${i}`, `Value ${i}`]),
    );
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { i18next: "23.0.0" },
      }),
      "src/i18n/en.ts": `export default ${JSON.stringify(keys)};`,
      "src/boot.ts": `
        import i18next from "i18next";
        import en from "./i18n/en";
        i18next.addResourceBundle("en", "bulk", en);
      `,
    });

    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });
    expect(catalog.namespaces).toEqual(["bulk"]);
    expect(
      catalog.keys.filter((k) => k.namespace === "bulk" && k.locale === "en"),
    ).toHaveLength(200);
  });
});
