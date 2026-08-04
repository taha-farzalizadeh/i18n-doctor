import { describe, expect, it } from "vitest";
import {
  createCoverageAnalyzer,
  pickBaseLocale,
} from "../src/index.js";
import { catalog, keyDef } from "./helpers.js";

describe("pickBaseLocale", () => {
  it("prefers en when present", () => {
    expect(pickBaseLocale(["fa", "en", "de"])).toBe("en");
  });

  it("honors explicit base", () => {
    expect(pickBaseLocale(["fa", "en"], "fa")).toBe("fa");
  });
});

describe("coverage analyzer", () => {
  it("detects missing keys per locale", () => {
    const c = catalog("/proj", [
      keyDef("auth.login", "locales/en/auth.json", "en", {
        namespace: "auth",
        line: 2,
      }),
      keyDef("auth.login", "locales/de/auth.json", "de", {
        namespace: "auth",
        line: 2,
      }),
      // fa missing auth.login
      keyDef("auth.logout", "locales/en/auth.json", "en", {
        namespace: "auth",
        line: 4,
      }),
      keyDef("auth.logout", "locales/fa/auth.json", "fa", {
        namespace: "auth",
        line: 4,
      }),
      keyDef("auth.logout", "locales/de/auth.json", "de", {
        namespace: "auth",
        line: 4,
      }),
    ]);

    const result = createCoverageAnalyzer().analyze({
      catalog: c,
      options: { baseLocale: "en" },
    });

    expect(result.baseLocale).toBe("en");
    expect(result.locales).toEqual(["de", "en", "fa"]);

    const login = result.keys.find((k) => k.key === "auth.login")!;
    expect(login.locales).toEqual({ de: true, en: true, fa: false });
    expect(login.missingLocales).toEqual(["fa"]);
    expect(login.coverage).toBeCloseTo(2 / 3);
    expect(login.files.some((f) => f.locale === "en" && f.line === 2)).toBe(
      true,
    );

    expect(result.missing.map((m) => m.key)).toContain("auth.login");
    expect(result.stats.missingCount).toBeGreaterThanOrEqual(1);
    expect(result.stats.coveragePercent).toBeLessThan(100);
  });

  it("detects extra keys only in one locale", () => {
    const c = catalog("/proj", [
      keyDef("shared", "en.json", "en"),
      keyDef("shared", "fa.json", "fa"),
      keyDef("only.fa", "fa.json", "fa", { line: 9 }),
    ]);

    const result = createCoverageAnalyzer().analyze({
      catalog: c,
      options: { baseLocale: "en" },
    });

    expect(result.extra).toHaveLength(1);
    expect(result.extra[0]?.key).toBe("only.fa");
    expect(result.extra[0]?.locales).toEqual(["fa"]);
    expect(result.extra[0]?.files[0]?.line).toBe(9);
  });

  it("reports namespace coverage", () => {
    const c = catalog("/proj", [
      keyDef("a", "en/common.json", "en", { namespace: "common" }),
      keyDef("a", "fa/common.json", "fa", { namespace: "common" }),
      keyDef("b", "en/home.json", "en", { namespace: "home" }),
      // fa missing home.b
    ]);

    const result = createCoverageAnalyzer().analyze({
      catalog: c,
      options: { baseLocale: "en" },
    });

    const home = result.stats.byNamespace.find((n) => n.namespace === "home");
    expect(home?.missingCount).toBe(1);
    expect(home?.coverage).toBeLessThan(1);

    const common = result.stats.byNamespace.find(
      (n) => n.namespace === "common",
    );
    expect(common?.coverage).toBe(1);
  });

  it("compares nested keys independently", () => {
    const c = catalog("/proj", [
      keyDef("nav.home.title", "en.json", "en"),
      keyDef("nav.home.title", "fa.json", "fa"),
      keyDef("nav.home.subtitle", "en.json", "en"),
      // fa missing subtitle
    ]);

    const result = createCoverageAnalyzer().analyze({
      catalog: c,
      options: { baseLocale: "en" },
    });

    const sub = result.missing.find((m) => m.key === "nav.home.subtitle");
    expect(sub?.missingLocales).toEqual(["fa"]);
    expect(
      result.missing.find((m) => m.key === "nav.home.title"),
    ).toBeUndefined();
  });

  it("analyzeMonorepo merges package catalogs", () => {
    const a = catalog("/ws/a", [
      keyDef("x", "en.json", "en"),
      keyDef("x", "fa.json", "fa"),
    ]);
    const b = catalog("/ws/b", [
      keyDef("y", "en.json", "en"),
      // fa missing y
    ]);

    const result = createCoverageAnalyzer().analyzeMonorepo([a, b], {
      baseLocale: "en",
    });
    expect(result.keys.map((k) => k.key).sort()).toEqual(["x", "y"]);
    expect(result.missing.map((m) => m.key)).toContain("y");
  });
});
