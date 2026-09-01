import { afterEach, describe, expect, it } from "vitest";
import {
  createProjectEslint,
  DEMO_FIXTURE,
  lintProject,
  messagesForFile,
  writeFixture,
} from "./helpers.js";
import {
  getAnalyzeScopeCallCount,
  resetAnalysisSessions,
} from "../src/index.js";

afterEach(() => {
  resetAnalysisSessions();
});

describe("acceptance — demo fixture", () => {
  it("lints locale json directly", async () => {
    const root = writeFixture(DEMO_FIXTURE);
    const eslint = createProjectEslint(root);
    const file = `${root}/locales/en/auth.json`;
    const results = await eslint.lintFiles([file]);
    const msgs = results.flatMap((r) => r.messages);
    expect(msgs.length, JSON.stringify(results, null, 2)).toBeGreaterThan(0);
  });

  it("reports resolvable findings across source and locale files", async () => {
    const root = writeFixture(DEMO_FIXTURE);
    const messages = await lintProject(root);

    const i18nMessages = messages.filter((m) =>
      m.ruleId?.startsWith("i18n-doctor/"),
    );
    expect(
      i18nMessages.length,
      i18nMessages.map((m) => `${m.ruleId} @ ${m.filePath}:${m.line}`).join("\n"),
    ).toBeGreaterThan(0);

    const login = messagesForFile(messages, "src/Login.tsx");
    expect(login.some((m) => m.ruleId === "i18n-doctor/no-missing-key")).toBe(
      true,
    );
    expect(
      login.some(
        (m) =>
          m.ruleId === "i18n-doctor/no-missing-key" &&
          (m.message.includes("signin") || m.message.includes("auth:signin")),
      ),
    ).toBe(true);
    expect(login.some((m) => m.ruleId === "i18n-doctor/no-untranslated")).toBe(
      true,
    );
    expect(
      login.some((m) => m.message.includes("Welcome back")),
    ).toBe(true);

    const enAuth = messagesForFile(messages, "locales/en/auth.json");
    const localeUnused = messages.some(
      (m) =>
        m.ruleId === "i18n-doctor/no-unused-key" &&
        m.filePath.includes("locales/en/auth.json"),
    );
    expect(localeUnused || enAuth.some((m) => m.ruleId === "i18n-doctor/no-unused-key")).toBe(
      true,
    );
    expect(
      messages.some(
        (m) =>
          m.ruleId === "i18n-doctor/no-unused-key" &&
          (m.message.includes("old") || m.message.includes("logout")),
      ),
    ).toBe(true);
    expect(
      enAuth.some((m) => m.ruleId === "i18n-doctor/locale-consistency"),
    ).toBe(true);

    const common = messagesForFile(messages, "locales/en/common.json");
    expect(
      common.some((m) => m.ruleId === "i18n-doctor/no-duplicate-key"),
    ).toBe(true);

    // Dynamic key must not invent a missing-key for HELLO_* catalog entries.
    expect(
      login.some((m) => m.message.includes("HELLO_")),
    ).toBe(false);
  });

  it("does not require manual i18n-doctor CLI invocation", async () => {
    const root = writeFixture(DEMO_FIXTURE);
    const messages = await lintProject(root);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every((m) => m.ruleId?.startsWith("i18n-doctor/"))).toBe(
      true,
    );
  });
});

describe("performance — shared session", () => {
  it("runs one project analysis when all five rules lint multiple files", async () => {
    resetAnalysisSessions();
    const root = writeFixture(DEMO_FIXTURE);
    await lintProject(root);
    expect(getAnalyzeScopeCallCount()).toBe(1);
  });
});

describe("independent ESLint runs", () => {
  it("starts a fresh session after resetAnalysisSessions()", async () => {
    const root = writeFixture(DEMO_FIXTURE);

    resetAnalysisSessions();
    await lintProject(root);
    expect(getAnalyzeScopeCallCount()).toBe(1);

    resetAnalysisSessions();
    await lintProject(root);
    expect(getAnalyzeScopeCallCount()).toBe(1);
  });
});
