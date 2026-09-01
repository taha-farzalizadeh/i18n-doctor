import { describe, expect, it } from "vitest";
import { runCheck } from "../src/internal/run-check.js";
import { fixture } from "./helpers.js";
import type { Issue } from "@i18n-doctor/issues";

const CONFIG_TS = `
import { defineConfig } from "i18n-doctor";

export default defineConfig({
  ignoreKeys: ["SERVER_*", "BACKEND_*"],
});
`;

/**
 * Fixture matching the documented ignoreKeys use case:
 * SERVER_* / BACKEND_* keys exist in the catalogs but are referenced
 * dynamically (e.g. `t(apiResponse.messageKey)`) — the analyzer cannot
 * prove them used, so users mark them ignored.
 */
function ignoreKeysFixture(configFile: Record<string, string> = {}): string {
  return fixture({
    "package.json": JSON.stringify({
      name: "demo",
      dependencies: { i18next: "23.0.0", "react-i18next": "14.0.0" },
    }),
    ...configFile,
    "locales/en/common.json": JSON.stringify({
      title: "Title",
      farewell: "Farewell",
      SERVER_USER_CREATED: "User created",
      SERVER_USER_DELETED: "User deleted",
    }),
    "locales/en/errors.json": JSON.stringify({
      BACKEND_ERROR: "Backend error",
      usedError: "Used error",
    }),
    // Second definition of common:title → duplicate-key must stay active.
    "i18n/en/common.json": JSON.stringify({ title: "Title duplicate" }),
    "src/App.tsx": `
      import { useTranslation } from 'react-i18next';
      export function App() {
        const { t } = useTranslation('common');
        const { t: tErr } = useTranslation('errors');
        return (
          <div>
            <span>{t('title')}</span>
            <span>{t('hello')}</span>
            <span>{tErr('usedError')}</span>
            <span>{tErr('BACKEND_TIMEOUT')}</span>
            <p>Welcome</p>
          </div>
        );
      }
    `,
  });
}

function issuesOf(result: Awaited<ReturnType<typeof runCheck>>): Issue[] {
  return [...result.analysis.issues];
}

function unusedKeys(issues: readonly Issue[]): string[] {
  return issues
    .filter((i) => i.type === "unused-key")
    .map((i) => i.key);
}

describe("check — i18n-doctor.config.ts ignoreKeys", () => {
  it("suppresses unused for ignored keys and keeps every other rule", async () => {
    const root = ignoreKeysFixture({ "i18n-doctor.config.ts": CONFIG_TS });

    const result = await runCheck({ path: root, json: true, noColor: true });
    const issues = issuesOf(result);
    const unused = unusedKeys(issues);

    // ignoreKeys → unused suppressed for glob matches
    expect(unused.some((k) => /SERVER_USER_CREATED/.test(k))).toBe(false);
    expect(unused.some((k) => /SERVER_USER_DELETED/.test(k))).toBe(false);
    expect(unused.some((k) => /BACKEND_ERROR/.test(k))).toBe(false);

    // Normal analysis continues
    expect(unused.some((k) => /farewell/.test(k))).toBe(true);

    // Rule isolation — ignoreKeys must NOT suppress these:
    expect(
      issues.some(
        (i) => i.type === "missing-key" && /hello/.test(i.key),
      ),
    ).toBe(true);
    expect(
      issues.some(
        (i) => i.type === "missing-key" && /BACKEND_TIMEOUT/.test(i.key),
      ),
    ).toBe(true);
    expect(issues.some((i) => i.type === "duplicate-key")).toBe(true);
    expect(issues.some((i) => i.type === "untranslated-text")).toBe(true);
  });

  it("reports ignored keys as unused when no config file exists", async () => {
    const root = ignoreKeysFixture();

    const result = await runCheck({ path: root, json: true, noColor: true });
    const unused = unusedKeys(issuesOf(result));

    expect(unused.some((k) => /SERVER_USER_CREATED/.test(k))).toBe(true);
    expect(unused.some((k) => /SERVER_USER_DELETED/.test(k))).toBe(true);
    expect(unused.some((k) => /BACKEND_ERROR/.test(k))).toBe(true);
    expect(unused.some((k) => /farewell/.test(k))).toBe(true);
  });

  it("behaves like no-config when ignoreKeys is empty", async () => {
    const root = ignoreKeysFixture({
      "i18n-doctor.config.ts": `
        import { defineConfig } from "i18n-doctor";
        export default defineConfig({ ignoreKeys: [] });
      `,
    });

    const result = await runCheck({ path: root, json: true, noColor: true });
    const unused = unusedKeys(issuesOf(result));

    expect(unused.some((k) => /SERVER_USER_CREATED/.test(k))).toBe(true);
    expect(unused.some((k) => /BACKEND_ERROR/.test(k))).toBe(true);
    expect(unused.some((k) => /farewell/.test(k))).toBe(true);
  });
});
