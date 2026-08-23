import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TranslationCatalog } from "@i18n-doctor/sources";
import { createAnalysisCache } from "../src/cache.js";

const ROOT = path.join(path.sep, "project");
const p = (...segments: string[]): string => path.join(ROOT, ...segments);

describe("change classification", () => {
  const cache = createAnalysisCache();

  it("treats a translation file as a source-only change", () => {
    expect(cache.classify(p("locales", "en.json"))).toEqual({
      sources: true,
      usages: false,
      config: false,
    });
    expect(cache.classify(p("locales", "en.yaml")).usages).toBe(false);
    expect(cache.classify(p("locales", "en.YML")).usages).toBe(false);
  });

  it("treats a code file as affecting both halves", () => {
    for (const file of [
      "src/App.ts",
      "src/App.tsx",
      "src/App.js",
      "src/App.jsx",
      "src/App.mjs",
      "src/App.vue",
      "src/App.svelte",
    ]) {
      const invalidation = cache.classify(p(...file.split("/")));
      expect(invalidation.usages, file).toBe(true);
      expect(invalidation.config, file).toBe(false);
    }
  });

  it("invalidates everything for a config file", () => {
    for (const file of [
      "i18n-doctor.config.ts",
      "i18n-doctor.config.js",
      "i18n-doctor.config.mjs",
      "i18n-doctor.config.cjs",
      "i18n-doctor.config.json",
      "package.json",
    ]) {
      expect(cache.classify(p(file)), file).toEqual({
        sources: true,
        usages: true,
        config: true,
      });
    }
  });

  it("invalidates both halves for a file it cannot classify", () => {
    expect(cache.classify(p("assets", "logo.svg"))).toEqual({
      sources: true,
      usages: true,
      config: false,
    });
  });

  it("re-runs usage detection for a code file that is also a catalog", () => {
    const withCatalog = createAnalysisCache();
    const entry = withCatalog.entry(ROOT);
    entry.sourceCatalog = catalogWith(ROOT, ["locales/en.ts"]);

    // A `.ts` catalog can hold both definitions and `t()` calls.
    expect(withCatalog.classify(p("locales", "en.ts"))).toEqual({
      sources: true,
      usages: true,
      config: false,
    });
  });

  it("skips usage detection for a JSON file that is a known catalog", () => {
    const withCatalog = createAnalysisCache();
    withCatalog.entry(ROOT).sourceCatalog = catalogWith(ROOT, [
      "locales/en.json",
    ]);

    expect(withCatalog.classify(p("locales", "en.json"))).toEqual({
      sources: true,
      usages: false,
      config: false,
    });
  });
});

describe("scope invalidation", () => {
  it("starts every new scope fully dirty", () => {
    const cache = createAnalysisCache();
    expect(cache.isDirty(ROOT)).toBe(true);
    expect(cache.entry(ROOT).dirty).toEqual({
      sources: true,
      usages: true,
      config: true,
    });
  });

  it("reports clean once the caller marks the entry analyzed", () => {
    const cache = createAnalysisCache();
    const entry = cache.entry(ROOT);
    entry.dirty = { sources: false, usages: false, config: false };

    expect(cache.isDirty(ROOT)).toBe(false);
    expect(cache.anyDirty()).toBe(false);
  });

  it("dirties only the scope that contains the file", () => {
    const cache = createAnalysisCache();
    const appRoot = p("packages", "app");
    const libRoot = p("packages", "lib");
    const clean = { sources: false, usages: false, config: false };
    cache.entry(appRoot).dirty = { ...clean };
    cache.entry(libRoot).dirty = { ...clean };

    cache.invalidateFile(path.join(appRoot, "src", "App.tsx"));

    expect(cache.isDirty(appRoot)).toBe(true);
    expect(cache.isDirty(libRoot)).toBe(false);
  });

  it("dirties every scope for a file outside all of them", () => {
    const cache = createAnalysisCache();
    const appRoot = p("packages", "app");
    cache.entry(appRoot).dirty = { sources: false, usages: false, config: false };

    cache.invalidateFile(path.join(path.sep, "elsewhere", "x.json"));

    expect(cache.isDirty(appRoot)).toBe(true);
  });

  it("accumulates invalidations rather than overwriting them", () => {
    const cache = createAnalysisCache();
    const entry = cache.entry(ROOT);
    entry.dirty = { sources: false, usages: false, config: false };

    cache.invalidateFile(p("locales", "en.json"));
    expect(entry.dirty).toEqual({
      sources: true,
      usages: false,
      config: false,
    });

    cache.invalidateFile(p("src", "App.tsx"));
    expect(entry.dirty).toEqual({ sources: true, usages: true, config: false });
  });

  it("keeps cached catalogs across an invalidation so they can be reused", () => {
    const cache = createAnalysisCache();
    const entry = cache.entry(ROOT);
    entry.sourceCatalog = catalogWith(ROOT, ["locales/en.json"]);
    entry.dirty = { sources: false, usages: false, config: false };

    cache.invalidateFile(p("src", "App.tsx"));

    // Usage detection re-runs; the untouched catalog is still available.
    expect(entry.sourceCatalog).toBeDefined();
    expect(entry.dirty.usages).toBe(true);
  });

  it("drops scopes that no longer exist", () => {
    const cache = createAnalysisCache();
    const appRoot = p("packages", "app");
    const goneRoot = p("packages", "gone");
    cache.entry(appRoot).sourceCatalog = catalogWith(appRoot, ["en.json"]);
    cache.entry(goneRoot).dirty = { sources: false, usages: false, config: false };

    cache.retainScopes([appRoot]);

    expect(cache.entry(appRoot).sourceCatalog).toBeDefined();
    // The dropped scope is recreated fully dirty on next access.
    expect(cache.entry(goneRoot).dirty.config).toBe(true);
  });

  it("reset clears cached catalogs entirely", () => {
    const cache = createAnalysisCache();
    cache.entry(ROOT).sourceCatalog = catalogWith(ROOT, ["en.json"]);

    cache.reset();

    expect(cache.entry(ROOT).sourceCatalog).toBeUndefined();
  });

  it("matches windows paths case-insensitively", () => {
    const cache = createAnalysisCache({ platform: "win32" });
    cache.entry("C:\\Project").dirty = {
      sources: false,
      usages: false,
      config: false,
    };

    cache.invalidateFile("c:\\project\\src\\App.tsx");

    expect(cache.isDirty("C:\\Project")).toBe(true);
  });
});

function catalogWith(
  root: string,
  files: readonly string[],
): TranslationCatalog {
  return {
    root,
    sources: files.map((filePath) => ({
      filePath,
      format: "json",
      entries: [],
    })),
    locales: [],
    namespaces: [],
    stats: { files: files.length, keys: 0, locales: 0, namespaces: 0 },
  } as unknown as TranslationCatalog;
}
