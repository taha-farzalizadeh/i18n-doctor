import { describe, expect, it } from "vitest";
import { createSourceDetector } from "../src/index.js";
import { fixture } from "./helpers.js";

describe("framework translation sources", () => {
  it("react-i18next / i18next resources", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { i18next: "23.0.0", "react-i18next": "14.0.0" },
      }),
      "src/i18n.ts": `
        export const resources = {
          en: {
            translation: { hello: 'Hello' },
            common: { ok: 'OK' },
          },
          de: {
            translation: { hello: 'Hallo' },
          },
        };
      `,
    });
    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });
    expect(catalog.locales).toEqual(expect.arrayContaining(["en", "de"]));
    expect(catalog.namespaces).toEqual(
      expect.arrayContaining(["translation", "common"]),
    );
    const enCommon = catalog.sources.find(
      (s) => s.locale === "en" && s.namespace === "common",
    );
    expect(enCommon?.keys.some((k) => k.key === "ok")).toBe(true);
  });

  it("next-intl message files", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "next-intl": "3.0.0", next: "15.0.0" },
      }),
      "messages/en.json": JSON.stringify({
        HomePage: { title: "Hello", cta: "Go" },
      }),
      "messages/fr.json": JSON.stringify({
        HomePage: { title: "Bonjour", cta: "Aller" },
      }),
    });
    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });
    expect(catalog.locales).toEqual(["en", "fr"]);
    expect(
      catalog.keys.filter((k) => k.key === "HomePage.title").length,
    ).toBe(2);
  });

  it("vue-i18n messages map", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { vue: "3.5.0", "vue-i18n": "9.0.0" },
      }),
      "src/i18n.ts": `
        export const messages = {
          en: { hello: 'Hello' },
          fr: { hello: 'Bonjour' },
        };
      `,
    });
    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });
    expect(catalog.locales).toEqual(expect.arrayContaining(["en", "fr"]));
    expect(catalog.keys.filter((k) => k.key === "hello").length).toBe(2);
  });

  it("react-intl defineMessages descriptors", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-intl": "6.0.0" },
      }),
      "src/messages.ts": `
        import { defineMessages } from 'react-intl';
        export const messages = defineMessages({
          save: {
            id: 'app.save',
            defaultMessage: 'Save',
            description: 'Save button',
          },
          cancel: {
            id: 'app.cancel',
            defaultMessage: 'Cancel',
          },
        });
      `,
    });
    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });
    expect(catalog.keys.some((k) => k.key === "app.save" && k.value === "Save")).toBe(
      true,
    );
    expect(
      catalog.keys.some((k) => k.key === "app.cancel" && k.value === "Cancel"),
    ).toBe(true);
  });

  it("react-intl plain messages object", async () => {
    const root = await fixture({
      "src/i18n/messages.ts": `
        export const messages = {
          'app.title': 'My App',
          'app.save': 'Save',
        };
      `,
    });
    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });
    expect(catalog.keys.map((k) => k.key).sort()).toEqual([
      "app.save",
      "app.title",
    ]);
  });
});
