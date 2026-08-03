import { describe, expect, it } from "vitest";
import { createSourceDetector } from "../src/index.js";
import { extractJsonEntries } from "../src/internal/extract-json.js";
import { fixture } from "./helpers.js";

describe("JSON extraction", () => {
  it("extracts flat keys", async () => {
    const root = await fixture({
      "locales/en.json": JSON.stringify({ hello: "Hello", bye: "Bye" }),
    });
    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });
    expect(catalog.keys.map((k) => k.key).sort()).toEqual(["bye", "hello"]);
    expect(catalog.sources[0]?.locale).toBe("en");
  });

  it("extracts nested keys and arrays", async () => {
    const root = await fixture({
      "locales/en/common.json": JSON.stringify({
        nav: { home: "Home" },
        items: [{ label: "A" }, { label: "B" }],
      }),
    });
    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });
    expect(catalog.keys.some((k) => k.key === "nav.home")).toBe(true);
    expect(catalog.keys.some((k) => k.key === "items[1].label")).toBe(true);
    expect(catalog.sources[0]?.namespace).toBe("common");
  });

  it("handles empty JSON object", async () => {
    const root = await fixture({
      "locales/en.json": "{}",
    });
    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });
    expect(catalog.sources).toEqual([]);
    expect(catalog.warnings.some((w) => w.code === "empty-resource")).toBe(true);
  });

  it("handles huge JSON files without throwing", async () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < 5000; i += 1) {
      big[`k${i}`] = `v${i}`;
    }
    const root = await fixture({
      "locales/en.json": JSON.stringify(big),
    });
    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });
    expect(catalog.stats.keyCount).toBe(5000);
    expect(catalog.keys[0]?.location.startLine).toBeGreaterThanOrEqual(1);
  });

  it("warns on invalid JSON", async () => {
    const root = await fixture({
      "locales/en.json": "{ broken",
    });
    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });
    expect(catalog.warnings.some((w) => w.code === "parse-failed")).toBe(true);
    expect(catalog.sources).toEqual([]);
  });

  it("detects duplicate keys in JSON text", () => {
    const result = extractJsonEntries('{"a":"1","a":"2","b":"3"}');
    expect(result.duplicateKeys).toEqual(expect.arrayContaining(["a"]));
    expect(result.entries.some((e) => e.key === "a" && e.value === "2")).toBe(
      true,
    );
  });

  it("supports BOM-prefixed JSON", () => {
    const result = extractJsonEntries("\uFEFF{\"hello\":\"Hi\"}");
    expect(result.entries).toEqual([
      expect.objectContaining({ key: "hello", value: "Hi" }),
    ]);
  });
});
