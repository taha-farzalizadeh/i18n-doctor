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

  it("rebuilds when i18n-doctor.config changes without process reset", async () => {
    resetAnalysisSessions();
    ensureWorkerBuilt();
    const fs = await import("node:fs");
    const root = writeFixture({
      "package.json": jsonString({
        name: "session-config-invalidate",
        dependencies: { i18next: "^23.0.0", "react-i18next": "^14.0.0" },
      }),
      "locales/en.json": jsonString({
        SERVER_USER: "User",
        farewell: "Bye",
      }),
      "src/App.tsx": `import { useTranslation } from "react-i18next";
export function App() { const { t } = useTranslation(); return t("used"); }`,
    });

    const first = getAnalysisSession({
      cwd: root,
      filename: path.join(root, "src/App.tsx"),
    });
    expect(first.issues.some((i) => i.key === "SERVER_USER")).toBe(true);

    // Ensure mtime advances on fast filesystems.
    await new Promise((r) => setTimeout(r, 20));
    fs.writeFileSync(
      path.join(root, "i18n-doctor.config.json"),
      jsonString({ ignoreKeys: ["SERVER_*"] }),
    );

    const second = getAnalysisSession({
      cwd: root,
      filename: path.join(root, "src/App.tsx"),
    });
    expect(second).not.toBe(first);
    expect(second.issues.some((i) => i.key === "SERVER_USER")).toBe(false);
    expect(second.issues.some((i) => i.key === "farewell")).toBe(true);
  });

  it("rebuilds when a locale catalog file changes on disk", async () => {
    resetAnalysisSessions();
    ensureWorkerBuilt();
    const fs = await import("node:fs");
    const root = writeFixture({
      "package.json": jsonString({
        name: "session-locale-invalidate",
        dependencies: { i18next: "^23.0.0", "react-i18next": "^14.0.0" },
      }),
      "locales/en.json": jsonString({
        hello: "Hello",
        orphan: "Unused",
      }),
      "src/App.tsx": `import { useTranslation } from "react-i18next";
export function App() { const { t } = useTranslation(); return t("hello"); }`,
    });

    const first = getAnalysisSession({
      cwd: root,
      filename: path.join(root, "locales/en.json"),
    });
    expect(first.issues.some((i) => i.key === "orphan")).toBe(true);

    await new Promise((r) => setTimeout(r, 20));
    fs.writeFileSync(
      path.join(root, "locales/en.json"),
      jsonString({ hello: "Hello" }),
    );

    const second = getAnalysisSession({
      cwd: root,
      filename: path.join(root, "locales/en.json"),
    });
    expect(second).not.toBe(first);
    expect(second.issues.some((i) => i.key === "orphan")).toBe(false);
  });

  it("rebuilds when the linted buffer overlay changes (unsaved edit)", () => {
    resetAnalysisSessions();
    ensureWorkerBuilt();
    const root = writeFixture({
      "package.json": jsonString({
        name: "session-overlay-invalidate",
        dependencies: { i18next: "^23.0.0", "react-i18next": "^14.0.0" },
      }),
      "locales/en.json": jsonString({
        hello: "Hello",
        orphan: "Unused",
      }),
      "src/App.tsx": `import { useTranslation } from "react-i18next";
export function App() { const { t } = useTranslation(); return t("hello"); }`,
    });

    const localePath = path.join(root, "locales/en.json");
    const first = getAnalysisSession({
      cwd: root,
      filename: localePath,
      readFile: (absolute) =>
        absolute === localePath
          ? jsonString({ hello: "Hello", orphan: "Unused" })
          : undefined,
    });
    expect(first.issues.some((i) => i.key === "orphan")).toBe(true);

    const second = getAnalysisSession({
      cwd: root,
      filename: localePath,
      readFile: (absolute) =>
        absolute === localePath ? jsonString({ hello: "Hello" }) : undefined,
    });
    expect(second).not.toBe(first);
    expect(second.issues.some((i) => i.key === "orphan")).toBe(false);
  });
});
