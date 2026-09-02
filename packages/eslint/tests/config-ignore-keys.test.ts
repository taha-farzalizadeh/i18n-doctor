import { afterEach, describe, expect, it } from "vitest";
import {
  lintProject,
  messagesForFile,
  writeFixture,
} from "./helpers.js";
import { resetAnalysisSessions } from "../src/index.js";
import { bareKey, ignoreKeysFixture, unusedKeyOf } from "./ignore-keys-fixture.js";

afterEach(() => {
  resetAnalysisSessions();
});

describe("eslint — i18n-doctor.config.ts ignoreKeys", () => {
  it("suppresses no-unused-key for ignored keys and keeps every other rule", async () => {
    const root = writeFixture(ignoreKeysFixture({
      "i18n-doctor.config.ts": `
import { defineConfig } from "i18n-doctor";

export default defineConfig({
  ignoreKeys: ["SERVER_*", "BACKEND_*"],
});
`,
    }));
    const messages = await lintProject(root);

    const unused = messages
      .map(unusedKeyOf)
      .filter((k): k is string => k !== undefined)
      .map(bareKey);

    expect(unused.some((k) => /SERVER_USER_CREATED/.test(k))).toBe(false);
    expect(unused.some((k) => /SERVER_USER_DELETED/.test(k))).toBe(false);
    expect(unused.some((k) => /BACKEND_ERROR/.test(k))).toBe(false);
    expect(unused.some((k) => /farewell/.test(k))).toBe(true);

    const app = messagesForFile(messages, "src/App.tsx");
    expect(
      app.some(
        (m) =>
          m.ruleId === "i18n-doctor/no-missing-key" &&
          /hello/.test(m.message),
      ),
    ).toBe(true);
    // An ignored key that is used but never defined is still missing.
    expect(
      app.some(
        (m) =>
          m.ruleId === "i18n-doctor/no-missing-key" &&
          /BACKEND_TIMEOUT/.test(m.message),
      ),
    ).toBe(true);
    expect(
      messages.some((m) => m.ruleId === "i18n-doctor/no-duplicate-key"),
    ).toBe(true);
    expect(
      app.some((m) => m.ruleId === "i18n-doctor/no-untranslated"),
    ).toBe(true);
  }, 60_000);

  it("reports ignored keys as unused when no config file exists", async () => {
    const root = writeFixture(ignoreKeysFixture());
    const messages = await lintProject(root);

    const unused = messages
      .map(unusedKeyOf)
      .filter((k): k is string => k !== undefined)
      .map(bareKey);

    expect(unused.some((k) => /SERVER_USER_CREATED/.test(k))).toBe(true);
    expect(unused.some((k) => /BACKEND_ERROR/.test(k))).toBe(true);
    expect(unused.some((k) => /farewell/.test(k))).toBe(true);
  }, 60_000);

  it("loads plain JSON / JS config without defineConfig import", async () => {
    const root = writeFixture(
      ignoreKeysFixture({
        "i18n-doctor.config.json": JSON.stringify(
          { ignoreKeys: ["SERVER_*", "BACKEND_*"] },
          null,
          2,
        ),
      }),
    );
    const messages = await lintProject(root);
    const unused = messages
      .map(unusedKeyOf)
      .filter((k): k is string => k !== undefined)
      .map(bareKey);

    expect(unused.some((k) => /SERVER_USER_CREATED/.test(k))).toBe(false);
    expect(unused.some((k) => /BACKEND_ERROR/.test(k))).toBe(false);
    expect(unused.some((k) => /farewell/.test(k))).toBe(true);
  }, 60_000);
});
