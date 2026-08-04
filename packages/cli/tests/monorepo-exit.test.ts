import { describe, expect, it } from "vitest";
import { mergeAnalysisResults } from "../src/internal/merge-results.js";
import { buildCliUserConfig } from "../src/internal/format-options.js";
import { runCheck } from "../src/internal/run-check.js";
import { fixture } from "./helpers.js";
import type { AnalysisResult } from "@i18n-unused/issues";

describe("monorepo support", () => {
  it("mergeAnalysisResults sorts and recounts", () => {
    const a: AnalysisResult = {
      root: "/ws/packages/a",
      issues: [
        {
          type: "unused-key",
          severity: "warning",
          message: "u",
          key: "b",
          location: {
            absolutePath: "/ws/packages/a/en.json",
            relativePath: "en.json",
            line: 1,
            column: 1,
          },
          relatedLocations: [],
          source: { kind: "definition" },
        },
      ],
      stats: {
        total: 1,
        unusedKey: 1,
        missingKey: 0,
        duplicateKey: 0,
        bySeverity: { warning: 1 },
      },
      timings: { totalMs: 5, analyzeMs: 2 },
    };
    const b: AnalysisResult = {
      root: "/ws/packages/b",
      issues: [
        {
          type: "missing-key",
          severity: "error",
          message: "m",
          key: "a",
          location: {
            absolutePath: "/ws/packages/b/App.tsx",
            relativePath: "App.tsx",
            line: 2,
            column: 1,
          },
          relatedLocations: [],
          source: { kind: "usage" },
        },
      ],
      stats: {
        total: 1,
        unusedKey: 0,
        missingKey: 1,
        duplicateKey: 0,
        bySeverity: { error: 1 },
      },
      timings: { totalMs: 7, analyzeMs: 3 },
    };
    const merged = mergeAnalysisResults("/ws", [a, b]);
    expect(merged.stats.total).toBe(2);
    expect(merged.issues[0]?.type).toBe("missing-key");
    expect(merged.issues[1]?.type).toBe("unused-key");
  });

  it("analyzes workspace packages when packages configured", async () => {
    const root = fixture({
      "package.json": JSON.stringify({
        name: "ws",
        private: true,
        workspaces: ["packages/*"],
      }),
      "i18n-unused.config.json": JSON.stringify({
        packages: ["packages/*"],
      }),
      "packages/web/package.json": JSON.stringify({
        name: "web",
        dependencies: { i18next: "23.0.0", "react-i18next": "14.0.0" },
      }),
      "packages/web/public/locales/en/common.json": JSON.stringify({
        hello: "Hi",
        orphan: "x",
      }),
      "packages/web/src/App.tsx": `
        import { useTranslation } from 'react-i18next';
        export const A = () => {
          const { t } = useTranslation('common');
          return t('hello');
        };
      `,
    });

    const result = await runCheck({ path: root, json: true, noColor: true });
    expect(result.exitCode).toBe(0);
    expect(result.report).toContain("orphan");
  }, 60_000);
});

describe("exit codes", () => {
  it("exit 1 when missing-key errors and exitOnError", async () => {
    const root = fixture({
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { i18next: "23.0.0", "react-i18next": "14.0.0" },
      }),
      "i18n-unused.config.json": JSON.stringify({
        exitOnError: true,
        failOnWarning: false,
      }),
      "public/locales/en/common.json": JSON.stringify({ hello: "Hi" }),
      "src/App.tsx": `
        import { useTranslation } from 'react-i18next';
        export const A = () => {
          const { t } = useTranslation('common');
          return t('missing.one');
        };
      `,
    });
    const result = await runCheck({ path: root, json: true, noColor: true });
    expect(result.analysis.stats.missingKey).toBeGreaterThan(0);
    expect(result.exitCode).toBe(1);
  }, 60_000);
});

describe("--ignore-duplicates", () => {
  it("maps to CLI config rules.duplicate-key=off", () => {
    expect(buildCliUserConfig({ ignoreDuplicates: true }).rules).toEqual({
      "duplicate-key": "off",
    });
  });

  it("disables duplicate-key on the effective config", async () => {
    const root = fixture({ "package.json": '{"name":"app"}' });
    const result = await runCheck({
      path: root,
      ignoreDuplicates: true,
      json: true,
      noColor: true,
    });
    expect(result.config.rules.isEnabled("duplicate-key")).toBe(false);
    expect(result.config.rules.getSeverity("duplicate-key")).toBe("off");
    expect(result.analysis.stats.duplicateKey).toBe(0);
  });
});
