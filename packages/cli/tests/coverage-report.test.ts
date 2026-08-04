import { describe, expect, it } from "vitest";
import type { CoverageResult } from "@i18n-doctor/coverage";
import { appendCoverageToReport } from "../src/internal/append-coverage.js";

function fakeCoverage(overrides: Partial<CoverageResult> = {}): CoverageResult {
  return {
    root: "/proj",
    baseLocale: "en",
    locales: ["en", "fa"],
    namespaces: ["common"],
    keys: [],
    missing: [
      {
        key: "onlyEn",
        namespace: "common",
        baseLocale: "en",
        locales: { en: true, fa: false },
        missingLocales: ["fa"],
        extraLocales: [],
        files: [
          {
            absolutePath: "/proj/en.json",
            relativePath: "locales/en.json",
            line: 1,
            column: 2,
            locale: "en",
            namespace: "common",
          },
        ],
        coverage: 0.5,
      },
    ],
    extra: [],
    stats: {
      totalKeys: 1,
      comparedLocales: 2,
      missingCount: 1,
      extraCount: 0,
      coveragePercent: 50,
      byNamespace: [],
      byLocale: [
        {
          locale: "en",
          presentCount: 1,
          baseKeyCount: 1,
          coverage: 1,
          extraCount: 0,
        },
        {
          locale: "fa",
          presentCount: 0,
          baseKeyCount: 1,
          coverage: 0,
          extraCount: 0,
        },
      ],
    },
    timings: { totalMs: 1, buildMs: 0, analyzeMs: 1 },
    ...overrides,
  };
}

describe("appendCoverageToReport", () => {
  it("injects locale coverage immediately after issues Summary", () => {
    const issues = [
      "i18n-doctor issues",
      "Root: /proj",
      "",
      "Summary",
      "  Unused:    1",
      "  Missing:   0",
      "  Duplicate: 0",
      "  Total:     1",
      "",
      "! UNUSED KEY",
      "  buried.issue",
      "",
    ].join("\n");

    const out = appendCoverageToReport(issues, fakeCoverage(), "terminal", {
      color: false,
    });

    const summaryIdx = out.indexOf("Total:     1");
    const coverageIdx = out.indexOf("Locale coverage");
    const missingIdx = out.indexOf("Missing in some locales");
    const buriedIdx = out.indexOf("buried.issue");

    expect(coverageIdx).toBeGreaterThan(summaryIdx);
    expect(missingIdx).toBeGreaterThan(coverageIdx);
    expect(buriedIdx).toBeGreaterThan(missingIdx);
    expect(out).toContain("Missing in other langs:");
    expect(out).toContain("onlyEn");
    expect(out).toContain("missing in: fa");
  });
});
