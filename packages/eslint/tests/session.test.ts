import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureWorkerBuilt,
  getAnalysisSession,
  resetAnalysisSessions,
  runProjectAnalysis,
} from "../src/internal/analysis-session.js";
import { jsonString, writeFixture } from "./helpers.js";

describe("analysis session", () => {
  it("reuses the same snapshot for multiple files in one process", () => {
    resetAnalysisSessions();
    ensureWorkerBuilt();
    const root = writeFixture({
      "package.json": jsonString({
        name: "session-demo",
        dependencies: { i18next: "^23.0.0", "react-i18next": "^14.0.0" },
      }),
      "locales/en.json": jsonString({ hello: "Hello", stale: "Unused" }),
      "src/A.tsx": `import { useTranslation } from "react-i18next";
export function A() { const { t } = useTranslation(); return t("hello"); }`,
      "src/B.tsx": `import { useTranslation } from "react-i18next";
export function B() { const { t } = useTranslation(); return t("missing"); }`,
    });

    const first = getAnalysisSession({
      cwd: root,
      filename: path.join(root, "src/A.tsx"),
    });
    const second = getAnalysisSession({
      cwd: root,
      filename: path.join(root, "src/B.tsx"),
    });

    expect(first).toBe(second);
    expect(first.analyzeScopeCalls).toBe(1);
    expect(first.issues.some((i) => i.type === "missing-key")).toBe(true);
    expect(first.issues.some((i) => i.type === "unused-key")).toBe(true);
  });

  it("isolates sessions between independent runs via reset", async () => {
    resetAnalysisSessions();
    const root = writeFixture({
      "package.json": jsonString({
        name: "session-reset",
        dependencies: { i18next: "^23.0.0" },
      }),
      "locales/en.json": jsonString({ ok: "OK" }),
      "src/App.js": `export const k = "ok";`,
    });

    await runProjectAnalysis({
      cwd: root,
      filename: path.join(root, "src/App.js"),
    });

    resetAnalysisSessions();
    ensureWorkerBuilt();
    getAnalysisSession({
      cwd: root,
      filename: path.join(root, "src/App.js"),
    });
    expect(
      getAnalysisSession({
        cwd: root,
        filename: path.join(root, "src/App.js"),
      }).analyzeScopeCalls,
    ).toBe(1);
  });
});
