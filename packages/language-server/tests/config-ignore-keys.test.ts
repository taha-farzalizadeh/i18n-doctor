import { describe, expect, it } from "vitest";
import { PKG_REACT_I18NEXT } from "./fixtures.js";
import { find, fixture, harness, json } from "./helpers.js";

const CONFIG_TS = `
import { defineConfig } from "i18n-doctor";

export default defineConfig({
  ignoreKeys: ["SERVER_*", "BACKEND_*"],
});
`;

async function ignoreKeysProject(
  configFile: Record<string, string> = {},
): Promise<ReturnType<typeof harness>> {
  const root = await fixture({
    "package.json": PKG_REACT_I18NEXT,
    ...configFile,
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
  });
  const h = harness(root);
  await h.start();
  return h;
}

describe("language server — i18n-doctor.config.ts ignoreKeys", () => {
  it("suppresses unused diagnostics for ignored keys and keeps every other rule", async () => {
    const h = await ignoreKeysProject({ "i18n-doctor.config.ts": CONFIG_TS });

    const locales = h.diagnosticsFor("locales/en.json");
    expect(find(locales, "unused-key", "SERVER_USER_CREATED")).toBeUndefined();
    expect(find(locales, "unused-key", "SERVER_USER_DELETED")).toBeUndefined();
    expect(find(locales, "unused-key", "farewell")).toBeDefined();

    // Duplicate key (title in locales/en.json + i18n/en.json) still reported.
    const all = Object.values(h.snapshot()).flat();
    expect(
      all.some((d) => d.code === "duplicate-key" && d.data?.key === "title"),
    ).toBe(true);

    const app = h.diagnosticsFor("src/App.tsx");
    expect(find(app, "missing-key", "hello")).toBeDefined();
    expect(app.some((d) => d.code === "untranslated-text")).toBe(true);
  }, 60_000);

  it("reports ignored keys as unused when no config file exists", async () => {
    const h = await ignoreKeysProject();

    const locales = h.diagnosticsFor("locales/en.json");
    expect(find(locales, "unused-key", "SERVER_USER_CREATED")).toBeDefined();
    expect(find(locales, "unused-key", "SERVER_USER_DELETED")).toBeDefined();
    expect(find(locales, "unused-key", "farewell")).toBeDefined();
  }, 60_000);
});
