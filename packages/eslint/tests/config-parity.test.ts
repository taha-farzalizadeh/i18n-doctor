import { afterEach, describe, expect, it } from "vitest";
import { runCheck } from "@i18n-doctor/cli";
import { writeFixture, lintProject } from "./helpers.js";
import { resetAnalysisSessions } from "../src/index.js";
import { bareKey, ignoreKeysFixture } from "./ignore-keys-fixture.js";

afterEach(() => {
  resetAnalysisSessions();
});

/**
 * Integration: the SAME i18n-doctor.config.ts must produce consistent
 * behavior when the project is analyzed by the CLI (`i18n-doctor check`)
 * and by the ESLint plugin.
 */
describe("config parity — CLI vs ESLint", () => {
  it("reports the same unused and missing keys from one i18n-doctor.config.ts", async () => {
    const root = writeFixture(
      ignoreKeysFixture({
        "i18n-doctor.config.ts": `
import { defineConfig } from "i18n-doctor";

export default defineConfig({
  ignoreKeys: ["SERVER_*", "BACKEND_*"],
});
`,
      }),
    );

    const cliResult = await runCheck({
      path: root,
      json: true,
      noColor: true,
    });
    const eslintMessages = await lintProject(root);

    const cliUnused = cliResult.analysis.issues
      .filter((i) => i.type === "unused-key")
      .map((i) => bareKey(i.key))
      .sort();
    const eslintUnused = eslintMessages
      .filter((m) => m.ruleId === "i18n-doctor/no-unused-key")
      .map((m) => bareKey(/^Translation key "([^"]+)" is unused\./.exec(m.message)?.[1] ?? ""))
      .filter((k) => k !== "")
      .sort();

    expect(eslintUnused).toEqual(cliUnused);
    // Sanity: ignored keys are absent from both, normal unused present in both.
    expect(cliUnused.some((k) => /SERVER_|BACKEND_ERROR/.test(k))).toBe(false);
    expect(cliUnused.some((k) => /farewell/.test(k))).toBe(true);

    const cliMissing = cliResult.analysis.issues
      .filter((i) => i.type === "missing-key")
      .map((i) => bareKey(i.key))
      .sort();
    const eslintMissing = eslintMessages
      .filter((m) => m.ruleId === "i18n-doctor/no-missing-key")
      .map((m) => bareKey(/^Translation key "([^"]+)" does not exist\.$/.exec(m.message)?.[1] ?? ""))
      .filter((k) => k !== "")
      .sort();

    expect(eslintMissing).toEqual(cliMissing);
  }, 90_000);
});
