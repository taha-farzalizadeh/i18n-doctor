import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildTranslationIndex, matchContextFromOptions } from "../src/index.js";
import { catalog, defaultMatch, keyDef } from "./helpers.js";

describe("buildTranslationIndex", () => {
  it("indexes catalog keys with exact ranges and source types", () => {
    const root = path.join("/tmp", "ti-root");
    const index = buildTranslationIndex(
      catalog(root, [
        keyDef("auth.login", "locales/en.json", "en", {
          line: 3,
          col: 5,
          endCol: 12,
          value: "Login",
        }),
        keyDef("auth.login", "locales/fa.json", "fa", {
          line: 3,
          value: "ورود",
        }),
      ]),
      { matchContext: defaultMatch, preferredLocales: ["en"] },
    );

    expect(index.size).toBe(2);
    const hits = index.lookup({ key: "auth.login" });
    expect(hits).toHaveLength(2);
    expect(hits[0]?.locale).toBe("en");
    expect(hits[0]?.value).toBe("Login");
    expect(hits[0]?.range.startLine).toBe(3);
    expect(hits[0]?.range.startCharacter).toBe(5);
    expect(hits[0]?.sourceFile).toBe(path.join(root, "locales/en.json"));
  });

  it("respects namespace matching for hasKey", () => {
    const index = buildTranslationIndex(
      catalog("/proj", [
        keyDef("SAVE", "public/locales/en/home.json", "en", {
          namespace: "home",
          value: "Save",
        }),
        keyDef("SAVE", "public/locales/en/settings.json", "en", {
          namespace: "settings",
          value: "Save settings",
        }),
      ]),
      { matchContext: matchContextFromOptions({ matchNamespace: true }) },
    );

    expect(index.hasKey({ key: "SAVE", namespace: "home" })).toBe(true);
    expect(index.hasKey({ key: "SAVE", namespace: "profile" })).toBe(false);
    expect(index.hasKey({ key: "MISSING", namespace: "home" })).toBe(false);
  });

  it("definitionsForUsage prefers configured locale", () => {
    const index = buildTranslationIndex(
      catalog("/proj", [
        keyDef("title", "locales/fa.json", "fa", { value: "عنوان" }),
        keyDef("title", "locales/en.json", "en", {
          line: 12,
          col: 4,
          endCol: 11,
          value: "Title",
        }),
      ]),
      { preferredLocales: ["en", "fa"] },
    );

    const defs = index.definitionsForUsage({ key: "title" });
    expect(defs[0]?.entry.locale).toBe("en");
    expect(defs[0]?.range.startLine).toBe(12);
    expect(defs).toHaveLength(2);
  });

  it("hover shows locales and missing warning", () => {
    const index = buildTranslationIndex(
      catalog("/proj", [
        keyDef("home.title", "locales/en.json", "en", {
          value: "Welcome back!",
        }),
        keyDef("home.title", "locales/fa.json", "fa", {
          value: "خوش آمدید!",
        }),
      ]),
      { preferredLocales: ["en"] },
    );

    const hover = index.hoverForUsage({ key: "home.title" });
    expect(hover.missing).toBe(false);
    expect(hover.locales.map((l) => l.locale)).toEqual(["en", "fa"]);
    expect(hover.locales[0]?.value).toBe("Welcome back!");
    expect(hover.source?.relativePath).toBe("locales/en.json");
    expect(hover.locales[1]?.relativePath).toBe("locales/fa.json");

    const missing = index.hoverForUsage({ key: "home.nope" });
    expect(missing.missing).toBe(true);
    expect(missing.locales).toEqual([]);
  });

  it("completions are prefix-aware, namespaced, and deduped", () => {
    const index = buildTranslationIndex(
      catalog("/proj", [
        keyDef("home.title", "locales/en.json", "en", { value: "Title" }),
        keyDef("home.title", "locales/fa.json", "fa", { value: "عنوان" }),
        keyDef("home.subtitle", "locales/en.json", "en", { value: "Sub" }),
        keyDef("auth.login", "locales/en.json", "en", { value: "Login" }),
        keyDef("SAVE", "ns/home.json", "en", {
          namespace: "home",
          value: "Save",
        }),
        keyDef("SAVE", "ns/settings.json", "en", {
          namespace: "settings",
          value: "Save settings",
        }),
      ]),
      {
        matchContext: matchContextFromOptions({ matchNamespace: true }),
        preferredLocales: ["en"],
      },
    );

    const home = index.completionsForPrefix("home.");
    expect(home.map((c) => c.label)).toEqual(["home.subtitle", "home.title"]);
    expect(home[1]?.detail).toBe("Title");

    const nsHome = index.completionsForPrefix("", { namespace: "home" });
    expect(nsHome.some((c) => c.label === "SAVE" && c.namespace === "home")).toBe(
      true,
    );
    expect(nsHome.some((c) => c.namespace === "settings")).toBe(false);
  });

  it("handles large catalogs without rebuilding per query", () => {
    const keys = Array.from({ length: 5_000 }, (_, i) =>
      keyDef(`k.${i}`, "locales/en.json", "en", { value: `v${i}` }),
    );
    const index = buildTranslationIndex(catalog("/proj", keys), {
      preferredLocales: ["en"],
    });

    const started = performance.now();
    for (let i = 0; i < 100; i++) {
      index.completionsForPrefix("k.42");
      index.hasKey({ key: "k.100" });
      index.definitionsForUsage({ key: "k.2500" });
    }
    expect(performance.now() - started).toBeLessThan(500);
  });
});
