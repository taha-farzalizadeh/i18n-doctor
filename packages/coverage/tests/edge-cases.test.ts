import { describe, expect, it } from "vitest";
import {
  createCoverageAnalyzer,
  formatCoverageJson,
  formatCoverageReport,
  mergeLocaleCatalogs,
  resolveLocales,
} from "../src/index.js";
import { catalog, keyDef } from "./helpers.js";

describe("basic parity", () => {
  it("no issues when locales match", () => {
    const c = catalog("/proj", [
      keyDef("login", "en.json", "en"),
      keyDef("login", "fa.json", "fa"),
    ]);
    const result = createCoverageAnalyzer().analyze({
      catalog: c,
      options: { baseLocale: "en" },
    });
    expect(result.missing).toEqual([]);
    expect(result.extra).toEqual([]);
    expect(result.issues ?? []).toEqual([]);
    expect(result.stats.coveragePercent).toBe(100);
  });
});

describe("missing translation", () => {
  it("flags fa when empty vs en base", () => {
    const result = createCoverageAnalyzer().analyze({
      catalog: catalog("/proj", [
        keyDef("login", "locales/en.json", "en", { line: 2 }),
        keyDef("login", "locales/de.json", "de", { line: 2 }),
      ]),
      options: { baseLocale: "en", locales: ["en", "fa"] },
    });
    const login = result.missing.find((m) => m.key === "login");
    expect(login?.missingLocales).toContain("fa");
    expect(login?.locales).toMatchObject({ en: true, fa: false });

    const issue = result.issues?.find(
      (i) => i.type === "missing-translation" && i.locale === "fa",
    );
    expect(issue?.key).toBe("login");
    expect(issue?.baseLocale).toBe("en");
    expect(issue?.suggestion).toMatch(/Add key/);
    expect(issue?.line).toBe(2);
    expect(issue?.filePath).toContain("en.json");
  });
});

describe("extra translation", () => {
  it("flags keys only in fa", () => {
    const result = createCoverageAnalyzer().analyze({
      catalog: catalog("/proj", [
        keyDef("shared", "en.json", "en"),
        keyDef("login", "fa.json", "fa", { line: 3 }),
      ]),
      options: { baseLocale: "en" },
    });
    expect(result.extra.map((e) => e.key)).toContain("login");
    const issue = result.issues?.find((i) => i.type === "extra-translation");
    expect(issue?.locale).toBe("fa");
    expect(issue?.suggestion).toMatch(/Remove key|add it to base/);
    expect(issue?.line).toBe(3);
  });
});

describe("nested objects", () => {
  it("compares deep paths independently", () => {
    const result = createCoverageAnalyzer().analyze({
      catalog: catalog("/proj", [
        keyDef("auth.login.title", "en.json", "en"),
        keyDef("auth.login.title", "fa.json", "fa"),
        keyDef("auth.login.subtitle", "en.json", "en"),
        keyDef("auth.profile.name", "en.json", "en"),
        keyDef("auth.profile.name", "fa.json", "fa"),
      ]),
      options: { baseLocale: "en" },
    });
    expect(result.missing.map((m) => m.key)).toEqual(["auth.login.subtitle"]);
    expect(result.stats.coveragePercent).toBeLessThan(100);
  });
});

describe("namespaces", () => {
  it("isolates same key across namespaces", () => {
    const result = createCoverageAnalyzer().analyze({
      catalog: catalog("/proj", [
        keyDef("title", "en/auth.json", "en", { namespace: "auth" }),
        keyDef("title", "fa/auth.json", "fa", { namespace: "auth" }),
        keyDef("title", "en/common.json", "en", { namespace: "common" }),
        // fa common title missing
      ]),
      options: { baseLocale: "en" },
    });
    const miss = result.missing.find(
      (m) => m.key === "title" && m.namespace === "common",
    );
    expect(miss?.missingLocales).toEqual(["fa"]);
    expect(
      result.missing.find((m) => m.key === "title" && m.namespace === "auth"),
    ).toBeUndefined();
  });

  it("reports per-namespace coverage", () => {
    const result = createCoverageAnalyzer().analyze({
      catalog: catalog("/proj", [
        keyDef("a", "en/settings.json", "en", { namespace: "settings" }),
        keyDef("a", "fa/settings.json", "fa", { namespace: "settings" }),
        keyDef("b", "en/common.json", "en", { namespace: "common" }),
      ]),
      options: { baseLocale: "en" },
    });
    const settings = result.stats.byNamespace.find(
      (n) => n.namespace === "settings",
    );
    const common = result.stats.byNamespace.find(
      (n) => n.namespace === "common",
    );
    expect(settings?.coverage).toBe(1);
    expect(common?.coverage).toBeLessThan(1);
  });
});

describe("locale resolution", () => {
  it("uses config defaultLocale when present", () => {
    const r = resolveLocales({
      catalogLocales: ["fa", "de"],
      configDefaultLocale: "de",
    });
    expect(r.baseLocale).toBe("de");
    expect(r.baseSource).toBe("config");
  });

  it("warns when base locale missing from catalog", () => {
    const r = resolveLocales({
      catalogLocales: ["fa"],
      requestedBase: "en",
    });
    expect(r.diagnostics.some((d) => d.code === "base-locale-missing")).toBe(
      true,
    );
  });

  it("reports fallback locale missing", () => {
    const r = resolveLocales({
      catalogLocales: ["en"],
      configFallbackLocales: ["en-GB"],
    });
    expect(
      r.diagnostics.some((d) => d.code === "fallback-locale-missing"),
    ).toBe(true);
  });
});

describe("duplicate locale definitions", () => {
  it("emits diagnostic when same key/locale defined in two files", () => {
    const model = mergeLocaleCatalogs([
      catalog("/proj", [
        keyDef("login", "a/en.json", "en"),
        keyDef("login", "b/en.json", "en"),
        keyDef("login", "a/fa.json", "fa"),
      ]),
    ]);
    expect(
      model.diagnostics?.some((d) => d.code === "duplicate-locale-definition"),
    ).toBe(true);
  });
});

describe("deterministic output", () => {
  it("JSON is byte-stable across runs", () => {
    const c = catalog("/proj", [
      keyDef("z", "en.json", "en"),
      keyDef("a", "en.json", "en"),
      keyDef("a", "fa.json", "fa"),
      keyDef("only", "de.json", "de"),
    ]);
    const analyzer = createCoverageAnalyzer();
    const a = formatCoverageJson(
      analyzer.analyze({ catalog: c, options: { baseLocale: "en" } }),
    );
    const b = formatCoverageJson(
      analyzer.analyze({ catalog: c, options: { baseLocale: "en" } }),
    );
    expect(a).toBe(b);
    const parsed = JSON.parse(a) as {
      issues: Array<{ type: string; key: string; locale: string }>;
    };
    // Sorted: extra before missing by type? compareIssues sorts by type then ns then key
    const types = parsed.issues.map((i) => `${i.type}:${i.key}:${i.locale}`);
    expect(types).toEqual([...types].sort((x, y) => x.localeCompare(y)));
  });

  it("terminal report includes suggestion and issue type", () => {
    const result = createCoverageAnalyzer().analyze({
      catalog: catalog("/proj", [
        keyDef("login", "en.json", "en"),
      ]),
      options: { baseLocale: "en", locales: ["en", "fa"] },
    });
    const text = formatCoverageReport(result, {
      color: false,
      hyperlinks: false,
    });
    expect(text).toContain("missing-translation");
    expect(text).toContain("suggestion:");
  });
});

describe("coverage percentages", () => {
  it("computes overall and per-locale accurately", () => {
    // 2 base keys × 2 locales = 4 cells; 3 present → 75%
    const result = createCoverageAnalyzer().analyze({
      catalog: catalog("/proj", [
        keyDef("a", "en.json", "en"),
        keyDef("a", "fa.json", "fa"),
        keyDef("b", "en.json", "en"),
        // b missing in fa
      ]),
      options: { baseLocale: "en" },
    });
    expect(result.stats.coveragePercent).toBe(75);
    const fa = result.stats.byLocale?.find((l) => l.locale === "fa");
    expect(fa?.coverage).toBe(0.5);
    expect(fa?.presentCount).toBe(1);
    expect(fa?.baseKeyCount).toBe(2);
  });
});

describe("paths", () => {
  it("normalizes Windows separators in relative paths", () => {
    const result = createCoverageAnalyzer().analyze({
      catalog: catalog("/proj", [
        keyDef("k", "locales\\en\\common.json", "en"),
        keyDef("k", "locales\\fa\\common.json", "fa"),
      ]),
      options: { baseLocale: "en" },
    });
    for (const f of result.keys[0]!.files) {
      expect(f.relativePath).not.toContain("\\");
      expect(f.relativePath).toContain("/");
    }
  });
});

describe("partially translated namespace", () => {
  it("does not crash and reports partial coverage", () => {
    const result = createCoverageAnalyzer().analyze({
      catalog: catalog("/proj", [
        keyDef("one", "en/ns.json", "en", { namespace: "ns" }),
        keyDef("two", "en/ns.json", "en", { namespace: "ns" }),
        keyDef("one", "fa/ns.json", "fa", { namespace: "ns" }),
      ]),
      options: { baseLocale: "en" },
    });
    expect(result.stats.byNamespace[0]?.coverage).toBe(0.75);
    expect(result.missing).toHaveLength(1);
  });
});

describe("base locale missing entirely", () => {
  it("treats all keys as extras", () => {
    const result = createCoverageAnalyzer().analyze({
      catalog: catalog("/proj", [keyDef("login", "fa.json", "fa")]),
      options: { baseLocale: "en" },
    });
    expect(result.extra.map((e) => e.key)).toContain("login");
    expect(result.diagnostics?.some((d) => d.code === "base-locale-missing")).toBe(
      true,
    );
  });
});

describe("huge locale trees", () => {
  it("handles 20k keys without throwing", () => {
    const keys = [];
    for (let i = 0; i < 10_000; i += 1) {
      keys.push(keyDef(`k.${i}`, "en.json", "en"));
      if (i % 2 === 0) keys.push(keyDef(`k.${i}`, "fa.json", "fa"));
    }
    const result = createCoverageAnalyzer().analyze({
      catalog: catalog("/proj", keys),
      options: { baseLocale: "en" },
    });
    expect(result.stats.totalKeys).toBe(10_000);
    expect(result.stats.missingCount).toBe(5_000);
    expect(result.stats.coveragePercent).toBe(75);
    expect(result.issues?.length).toBe(5_000);
  });
});

describe("monorepo merge", () => {
  it("merges catalogs without duplicate reports for same key identity", () => {
    const a = catalog("/ws/a", [
      keyDef("x", "en.json", "en", { namespace: "app" }),
    ]);
    const b = catalog("/ws/b", [
      keyDef("x", "en.json", "en", { namespace: "app" }),
      keyDef("x", "fa.json", "fa", { namespace: "app" }),
    ]);
    const result = createCoverageAnalyzer().analyzeMonorepo([a, b], {
      baseLocale: "en",
    });
    const xs = result.keys.filter(
      (k) => k.key === "x" && k.namespace === "app",
    );
    expect(xs).toHaveLength(1);
    expect(xs[0]?.missingLocales).toEqual([]);
  });
});

describe("no duplicate issue reports", () => {
  it("emits one issue per missing locale pair", () => {
    const result = createCoverageAnalyzer().analyze({
      catalog: catalog("/proj", [
        keyDef("k", "en.json", "en"),
      ]),
      options: { baseLocale: "en", locales: ["en", "fa", "de"] },
    });
    const miss = (result.issues ?? []).filter(
      (i) => i.type === "missing-translation" && i.key === "k",
    );
    expect(miss).toHaveLength(2);
    const locales = miss.map((i) => i.locale).sort();
    expect(locales).toEqual(["de", "fa"]);
  });
});
