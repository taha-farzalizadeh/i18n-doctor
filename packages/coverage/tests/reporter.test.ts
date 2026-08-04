import { describe, expect, it } from "vitest";
import {
  createCoverageAnalyzer,
  formatCoverageJson,
  formatCoverageReport,
} from "../src/index.js";
import { catalog, keyDef } from "./helpers.js";

describe("coverage reporters", () => {
  const result = createCoverageAnalyzer().analyze({
    catalog: catalog("/proj", [
      keyDef("auth.login", "locales/en.json", "en", { line: 2 }),
      // fa missing
      keyDef("ghost", "locales/fa.json", "fa", { line: 5 }),
    ]),
    options: { baseLocale: "en" },
  });

  it("JSON matches contract shape and is deterministic", () => {
    const a = formatCoverageJson(result);
    const b = formatCoverageJson(result);
    expect(a).toBe(b);

    const parsed = JSON.parse(a) as {
      baseLocale: string;
      missing: Array<{
        key: string;
        baseLocale: string;
        locales: Record<string, boolean>;
        missingLocales: string[];
        files: unknown[];
        coverage: number;
      }>;
      stats: { coveragePercent: number };
    };

    expect(parsed.baseLocale).toBe("en");
    const login = parsed.missing.find((m) => m.key === "auth.login")!;
    expect(login.locales.en).toBe(true);
    expect(login.locales.fa).toBe(false);
    expect(login.missingLocales).toEqual(["fa"]);
    expect(login.files.length).toBeGreaterThan(0);
    expect(typeof login.coverage).toBe("number");
    expect(parsed.stats.coveragePercent).toBeLessThan(100);
  });

  it("terminal report includes summary and locations", () => {
    const text = formatCoverageReport(result, { color: false });
    expect(text).toContain("i18n-doctor coverage");
    expect(text).toContain("Coverage:");
    expect(text).toContain("auth.login");
    expect(text).toContain("locales/en.json:2:1");
    expect(text).toContain("ghost");
  });
});
