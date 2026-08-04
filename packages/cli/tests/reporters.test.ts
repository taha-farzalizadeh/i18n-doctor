import { describe, expect, it } from "vitest";
import type { AnalysisResult, Issue } from "@i18n-unused/issues";
import { selectReporter, stabilizeResult } from "../src/internal/reporters/select.js";

function sample(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  const issues: Issue[] = [
    {
      type: "unused-key",
      severity: "warning",
      message: 'Unused translation key "z.key"',
      key: "z.key",
      location: {
        absolutePath: "/proj/locales\\en.json",
        relativePath: "locales\\en.json",
        line: 2,
        column: 3,
      },
      relatedLocations: [],
      source: { kind: "definition" },
    },
    {
      type: "missing-key",
      severity: "error",
      message: 'Missing translation key "a.key"',
      key: "a.key",
      location: {
        absolutePath: "/proj/src/App.tsx",
        relativePath: "src/App.tsx",
        line: 10,
        column: 5,
      },
      relatedLocations: [],
      source: { kind: "usage" },
    },
  ];
  return {
    root: "/proj",
    issues,
    stats: {
      total: 2,
      unusedKey: 1,
      missingKey: 1,
      duplicateKey: 0,
      bySeverity: { error: 1, warning: 1 },
    },
    timings: { totalMs: 10.7, analyzeMs: 4.2 },
    ...overrides,
  };
}

describe("stable reporters", () => {
  it("json is deterministic across calls", () => {
    const a = selectReporter("json").report(sample());
    const b = selectReporter("json").report(sample());
    expect(a).toBe(b);
    const parsed = JSON.parse(a) as {
      issues: Array<{ type: string; key: string; file?: string }>;
    };
    // Sorted: missing-key before unused-key
    expect(parsed.issues[0]?.type).toBe("missing-key");
    expect(parsed.issues[1]?.type).toBe("unused-key");
  });

  it("sarif is deterministic and schema-shaped", () => {
    const a = selectReporter("sarif").report(sample());
    const b = selectReporter("sarif").report(sample());
    expect(a).toBe(b);
    const doc = JSON.parse(a) as {
      version: string;
      $schema: string;
      runs: Array<{ results: Array<{ ruleId: string }> }>;
    };
    expect(doc.version).toBe("2.1.0");
    expect(doc.$schema).toContain("sarif");
    expect(doc.runs[0]?.results.map((r) => r.ruleId)).toEqual([
      "missing-key",
      "unused-key",
    ]);
  });

  it("markdown is deterministic and uses POSIX paths", () => {
    const a = selectReporter("markdown").report(sample());
    const b = selectReporter("markdown").report(sample());
    expect(a).toBe(b);
    expect(a).toContain("# i18n-unused report");
    expect(a).toContain("locales/en.json");
    expect(a).not.toContain("locales\\en.json");
  });

  it("html is deterministic and escapes content", () => {
    const withHtml = sample({
      issues: [
        {
          type: "unused-key",
          severity: "warning",
          message: 'Unused <script>alert(1)</script> key',
          key: "a<b>",
          location: {
            absolutePath: "/proj/x.json",
            relativePath: "x.json",
            line: 1,
            column: 1,
          },
          relatedLocations: [],
          source: { kind: "definition" },
        },
      ],
    });
    const a = selectReporter("html").report(withHtml);
    const b = selectReporter("html").report(withHtml);
    expect(a).toBe(b);
    expect(a).toContain("<!DOCTYPE html>");
    expect(a).toContain("&lt;script&gt;");
    expect(a).toContain("a&lt;b&gt;");
    expect(a).not.toContain("<script>alert");
  });

  it("silent returns empty", () => {
    expect(selectReporter("silent").report(sample())).toBe("");
  });

  it("stabilizeResult normalizes Windows separators", () => {
    const stable = stabilizeResult(sample());
    expect(stable.issues[0]?.location.relativePath).not.toContain("\\");
    expect(stable.timings.totalMs).toBe(11);
  });
});
