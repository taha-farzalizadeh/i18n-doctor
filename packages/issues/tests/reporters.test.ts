import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createIssueEngine,
  createJsonReporter,
  createTerminalReporter,
  formatJsonReport,
  formatTerminalReport,
  toFileUrl,
  type AnalysisResult,
  type Issue,
} from "../src/index.js";
import { ROOT, def, stripTimings, use } from "./helpers.js";

function analyzeFixture(): AnalysisResult {
  return createIssueEngine().analyze({
    root: ROOT,
    definitions: [
      def("auth.login.title", "src/locales/en/auth.json", 24, {
        locale: "en",
      }),
      def("dup.key", "locales/en/a.json", 1, { locale: "en" }),
      def("dup.key", "locales/en/b.json", 2, { locale: "en" }),
    ],
    usages: [
      use("dup.key", "src/App.tsx", 1),
      use("checkout.payment", "src/pages/Checkout.tsx", 81),
    ],
  });
}

describe("terminal reporter", () => {
  it("formats unused, missing, and duplicate blocks with relative paths", () => {
    const report = formatTerminalReport(analyzeFixture(), {
      color: false,
      hyperlinks: false,
    });

    expect(report).toContain("UNUSED KEY");
    expect(report).toContain("auth.login.title");
    expect(report).toContain("src/locales/en/auth.json:24:1");
    expect(report).toContain("No usages found");

    expect(report).toContain("MISSING KEY");
    expect(report).toContain("checkout.payment");
    expect(report).toContain("src/pages/Checkout.tsx:81:8");
    expect(report).toContain("No definition found");

    expect(report).toContain("DUPLICATE KEY");
    expect(report).toContain("dup.key");
    expect(report).toContain("locales/en/a.json:1:1");
    expect(report).toContain("locales/en/b.json:2:1");

    // Relative label + absolute file locator
    expect(report).toContain(`file://${ROOT}/src/locales/en/auth.json:24:1`);
    expect(report).toContain(`file://${ROOT}/src/pages/Checkout.tsx:81:8`);
  });

  it("emits OSC-8 clickable links with valid file hrefs when forced", () => {
    const report = formatTerminalReport(analyzeFixture(), {
      color: false,
      hyperlinks: true,
    });

    const oscOpen = "\u001b]8;;";
    const oscClose = "\u001b]8;;\u0007";
    expect(report).toContain(oscOpen);
    expect(report).toContain(oscClose);

    // Href is a valid file URI without :line:column
    expect(report).toContain(
      `${oscOpen}file://${ROOT}/src/pages/Checkout.tsx\u0007src/pages/Checkout.tsx:81:8${oscClose}`,
    );
    // Copy-paste locator still includes line:column
    expect(report).toContain(
      `file://${ROOT}/src/pages/Checkout.tsx:81:8`,
    );
  });

  it("includes absolute paths via file locators", () => {
    const report = formatTerminalReport(analyzeFixture(), {
      color: false,
      hyperlinks: false,
    });
    expect(report).toContain(`file://${ROOT}/`);
    expect(report).not.toContain("file://src/");
  });

  it("handles an empty result", () => {
    const result = createIssueEngine().analyze({
      root: ROOT,
      definitions: [def("ok", "a.json", 1)],
      usages: [use("ok", "src/a.tsx", 1)],
    });
    const report = formatTerminalReport(result, {
      color: false,
      hyperlinks: false,
    });
    expect(report).toContain("No issues found");
    expect(report).toContain("Unused:    0");
    expect(report).toContain("Missing:   0");
    expect(report).toContain("Duplicate: 0");
    expect(report).toContain("Total:     0");
    expect(report).not.toContain("UNUSED KEY");
  });

  it("handles many issues and respects maxIssues", () => {
    const definitions = Array.from({ length: 30 }, (_, i) =>
      def(`key.${String(i).padStart(2, "0")}`, `locales/k${i}.json`, 1),
    );
    const result = createIssueEngine().analyze({
      root: ROOT,
      definitions,
      usages: [],
    });
    expect(result.stats.unusedKey).toBe(30);

    const full = formatTerminalReport(result, {
      color: false,
      hyperlinks: false,
    });
    expect(full.match(/UNUSED KEY/g)?.length).toBe(30);

    const limited = formatTerminalReport(result, {
      color: false,
      hyperlinks: false,
      maxIssues: 5,
    });
    expect(limited.match(/UNUSED KEY/g)?.length).toBe(5);
    expect(limited).toContain("... +25 more issues");
  });

  it("is deterministic for the same AnalysisResult", () => {
    const result = analyzeFixture();
    const a = formatTerminalReport(result, {
      color: false,
      hyperlinks: false,
    });
    const b = formatTerminalReport(result, {
      color: false,
      hyperlinks: false,
    });
    expect(a).toBe(b);
  });

  it("exposes a stable reporter id", () => {
    expect(createTerminalReporter().id).toBe("terminal");
  });
});

describe("file URL helpers", () => {
  it("builds clickable file locators with line and column", () => {
    expect(
      toFileUrl({
        absolutePath: "/abs/src/App.tsx",
        relativePath: "src/App.tsx",
        line: 10,
        column: 4,
      }),
    ).toBe("file:///abs/src/App.tsx:10:4");
  });

  it("encodes spaces in absolute paths", () => {
    expect(
      toFileUrl({
        absolutePath: "/abs/my project/App.tsx",
        relativePath: "App.tsx",
        line: 1,
        column: 1,
      }),
    ).toBe("file:///abs/my%20project/App.tsx:1:1");
  });
});

describe("JSON reporter", () => {
  it("emits compact machine-readable issues", () => {
    const result = createIssueEngine().analyze({
      root: ROOT,
      definitions: [def("auth.login", "src/locales/en.json", 24)],
      usages: [],
    });
    const parsed = JSON.parse(
      formatJsonReport(result, { verbose: false, pretty: true }),
    ) as {
      issues: Array<Record<string, unknown>>;
      stats: Record<string, unknown>;
    };

    expect(parsed.issues[0]).toEqual({
      type: "unused-key",
      severity: "warning",
      key: "auth.login",
      file: "src/locales/en.json",
      line: 24,
      column: 1,
      message: expect.stringContaining("Unused translation key"),
    });
    expect(Object.keys(parsed.issues[0]!)).toEqual([
      "type",
      "severity",
      "key",
      "file",
      "line",
      "column",
      "message",
    ]);
  });

  it("emits verbose issues with absolute and relative paths", () => {
    const result = analyzeFixture();
    const parsed = JSON.parse(
      formatJsonReport(result, { verbose: true, pretty: false }),
    ) as { issues: Issue[] };

    const unused = parsed.issues.find((i) => i.type === "unused-key")!;
    expect(unused.location.absolutePath).toBe(
      path.join(ROOT, "src/locales/en/auth.json"),
    );
    expect(unused.location.relativePath).toBe("src/locales/en/auth.json");
    expect(unused.relatedLocations).toEqual([]);
  });

  it("handles an empty result", () => {
    const result = createIssueEngine().analyze({
      root: ROOT,
      definitions: [def("ok", "a.json", 1)],
      usages: [use("ok", "b.tsx", 1)],
    });
    const parsed = JSON.parse(
      formatJsonReport(result, { verbose: false, pretty: true }),
    ) as {
      issues: unknown[];
      stats: {
        total: number;
        unusedKey: number;
        missingKey: number;
        duplicateKey: number;
      };
    };
    expect(parsed.issues).toEqual([]);
    expect(parsed.stats).toMatchObject({
      total: 0,
      unusedKey: 0,
      missingKey: 0,
      duplicateKey: 0,
      untranslatedText: 0,
    });
  });

  it("handles many issues with stable ordering", () => {
    const definitions = Array.from({ length: 20 }, (_, i) =>
      def(`key.${String(i).padStart(2, "0")}`, `locales/k${i}.json`, i + 1),
    );
    const result = createIssueEngine().analyze({
      root: ROOT,
      definitions: [...definitions].reverse(),
      usages: [use("zzz.missing", "src/z.tsx", 1)],
    });
    const parsed = JSON.parse(
      formatJsonReport(result, { verbose: false, pretty: false }),
    ) as { issues: Array<{ type: string; key: string }> };

    expect(parsed.issues[0]).toMatchObject({
      type: "missing-key",
      key: "zzz.missing",
    });
    const unusedKeys = parsed.issues
      .filter((i) => i.type === "unused-key")
      .map((i) => i.key);
    expect(unusedKeys).toEqual(
      Array.from({ length: 20 }, (_, i) => `key.${String(i).padStart(2, "0")}`),
    );
  });

  it("is deterministic across runs (rounded timings + stable fields)", () => {
    const input = {
      root: ROOT,
      definitions: [
        def("b", "b.json", 2),
        def("a", "a.json", 1),
      ],
      usages: [use("missing", "src/m.tsx", 1)],
    };
    const a = stripTimings(
      JSON.parse(
        formatJsonReport(createIssueEngine().analyze(input), {
          verbose: false,
          pretty: true,
        }),
      ),
    );
    const b = stripTimings(
      JSON.parse(
        formatJsonReport(createIssueEngine().analyze(input), {
          verbose: false,
          pretty: true,
        }),
      ),
    );
    expect(a).toEqual(b);

    // Pretty JSON ends with newline for clean piping
    const raw = formatJsonReport(createIssueEngine().analyze(input), {
      verbose: false,
      pretty: true,
    });
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("uses integer timings for machine-readable stability", () => {
    const parsed = JSON.parse(
      formatJsonReport(analyzeFixture(), { verbose: false, pretty: false }),
    ) as { timings: { totalMs: number; analyzeMs: number } };
    expect(Number.isInteger(parsed.timings.totalMs)).toBe(true);
    expect(Number.isInteger(parsed.timings.analyzeMs)).toBe(true);
  });

  it("exposes a stable reporter id", () => {
    expect(createJsonReporter().id).toBe("json");
  });
});
