import { describe, expect, it } from "vitest";
import { createSourceDetector } from "../src/index.js";
import { extractJsRegions } from "../src/internal/extract-js.js";
import { fixture } from "./helpers.js";

describe("JS/TS extraction", () => {
  it("extracts const objects with message bindings", async () => {
    const root = await fixture({
      "src/i18n/messages.ts": `
        const messages = { hello: 'Hello', nested: { world: 'World' } };
        export { messages };
      `,
    });
    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });
    expect(catalog.keys.some((k) => k.key === "nested.world")).toBe(true);
  });

  it("extracts named exported objects", async () => {
    const root = await fixture({
      "src/i18n/catalog.ts": `
        export const catalog = { save: 'Save', cancel: 'Cancel' };
      `,
    });
    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });
    expect(catalog.keys.map((k) => k.key).sort()).toEqual(["cancel", "save"]);
  });

  it("extracts default exports", async () => {
    const root = await fixture({
      "messages/en.ts": `
        export default { title: 'Title', body: 'Body' } as const;
      `,
    });
    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });
    expect(catalog.keys.some((k) => k.key === "title")).toBe(true);
    expect(catalog.sources[0]?.locale).toBe("en");
  });

  it("extracts nested objects under messages property", () => {
    const regions = extractJsRegions(
      "i18n.ts",
      `
      export const config = {
        messages: {
          en: { hi: 'Hi' },
          fr: { hi: 'Salut' },
        },
      };
      `,
      { includeUnknown: false },
    );
    expect(regions.some((r) => r.locale === "en")).toBe(true);
    expect(regions.some((r) => r.locale === "fr")).toBe(true);
    expect(regions.flatMap((r) => r.entries).some((e) => e.key === "hi")).toBe(
      true,
    );
  });

  it("supports string computed properties and skips dynamic ones", () => {
    const regions = extractJsRegions(
      "messages.ts",
      `
      const key = 'dynamic';
      export const messages = {
        ['static.key']: 'Static',
        [key]: 'Dynamic',
        plain: 'Plain',
      };
      `,
      { includeUnknown: false },
    );
    const keys = regions.flatMap((r) => r.entries.map((e) => e.key));
    expect(keys).toContain("static.key");
    expect(keys).toContain("plain");
    expect(keys).not.toContain("dynamic");
  });

  it("does not expand spread objects", () => {
    const regions = extractJsRegions(
      "messages.ts",
      `
      const extra = { a: 'A' };
      export const messages = { ...extra, b: 'B' };
      `,
      { includeUnknown: false },
    );
    const keys = regions.flatMap((r) => r.entries.map((e) => e.key));
    expect(keys).toContain("b");
    expect(keys).not.toContain("a");
  });

  it("does not resolve imported objects", async () => {
    const root = await fixture({
      "src/i18n/base.ts": `export const shared = { a: 'A' };`,
      "src/i18n/messages.ts": `
        import { shared } from './base';
        export const messages = { ...shared, b: 'B' };
      `,
    });
    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });
    const keys = catalog.keys
      .filter((k) => k.filePath.includes("messages.ts"))
      .map((k) => k.key);
    expect(keys).toContain("b");
    expect(keys).not.toContain("a");
  });

  it("extracts objects returned from message-named functions", () => {
    const regions = extractJsRegions(
      "i18n.ts",
      `
      export function getMessages() {
        return { welcome: 'Welcome' };
      }
      export const loadMessages = () => ({ ok: 'OK' });
      `,
      { includeUnknown: false },
    );
    const keys = regions.flatMap((r) => r.entries.map((e) => e.key));
    expect(keys).toEqual(expect.arrayContaining(["welcome", "ok"]));
  });

  it("does not treat arbitrary function returns as sources", () => {
    const regions = extractJsRegions(
      "util.ts",
      `
      export function buildConfig() {
        return { port: 3000, name: 'app' };
      }
      `,
      { includeUnknown: false },
    );
    expect(regions).toEqual([]);
  });
});
