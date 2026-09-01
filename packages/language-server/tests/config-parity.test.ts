import { describe, expect, it } from "vitest";
import { runCheck } from "@i18n-doctor/cli";
import { PKG_REACT_I18NEXT } from "./fixtures.js";
import { fixture, harness, json } from "./helpers.js";

/**
 * Integration: the SAME i18n-doctor.config.ts must produce consistent
 * behavior when the project is analyzed by the CLI (`i18n-doctor check`)
 * and by the language server.
 */
describe("config parity — CLI vs language server", () => {
  it("reports the same unused and missing keys from one i18n-doctor.config.ts", async () => {
    const files = {
      "package.json": PKG_REACT_I18NEXT,
      "i18n-doctor.config.ts": `
import { defineConfig } from "i18n-doctor";

export default defineConfig({
  ignoreKeys: ["SERVER_*", "BACKEND_*"],
});
`,
      "locales/en.json": json({
        title: "Title",
        farewell: "Farewell",
        SERVER_USER_CREATED: "User created",
        SERVER_USER_DELETED: "User deleted",
      }),
      "i18n/en.json": json({ title: "Title duplicate" }),
      "src/App.tsx": `import { useTranslation } from "react-i18next";

export function App() {
  const { t } = useTranslation();
  return (
    <div>
      <span>{t("title")}</span>
      <span>{t("hello")}</span>
      <p>Welcome</p>
    </div>
  );
}
`,
    };

    const root = await fixture(files);
    const h = harness(root);
    await h.start();

    const cliResult = await runCheck({ path: root, json: true, noColor: true });
    const cliUnused = cliResult.analysis.issues
      .filter((i) => i.type === "unused-key")
      .map((i) => i.key)
      .sort();
    const cliMissing = cliResult.analysis.issues
      .filter((i) => i.type === "missing-key")
      .map((i) => i.key)
      .sort();

    const lspDiagnostics = Object.values(h.snapshot()).flat();
    const lspUnused = lspDiagnostics
      .filter((d) => d.code === "unused-key")
      .map((d) => d.data?.key)
      .filter((k): k is string => typeof k === "string")
      .sort();
    const lspMissing = lspDiagnostics
      .filter((d) => d.code === "missing-key")
      .map((d) => d.data?.key)
      .filter((k): k is string => typeof k === "string")
      .sort();

    expect(lspUnused).toEqual(cliUnused);
    expect(lspMissing).toEqual(cliMissing);

    // Sanity: ignored keys suppressed in both, normal unused present in both.
    expect(cliUnused.some((k) => /SERVER_/.test(k))).toBe(false);
    expect(cliUnused.some((k) => k === "farewell")).toBe(true);
  }, 90_000);
});
