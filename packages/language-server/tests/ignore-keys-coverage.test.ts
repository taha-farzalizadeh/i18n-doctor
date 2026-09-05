import { describe, expect, it } from "vitest";
import { PKG_REACT_I18NEXT } from "./fixtures.js";
import { find, fixture, harness, json } from "./helpers.js";

describe("ignoreKeys must not suppress locale coverage", () => {
  it("still reports missing-translation for ignoreKeys keys missing in another locale", async () => {
    const root = await fixture({
      "package.json": PKG_REACT_I18NEXT,
      "i18n-doctor.config.json": json({
        ignoreKeys: ["SERVER_*"],
      }),
      "locales/en.json": json({
        title: "Title",
        SERVER_X: "Server only in EN",
      }),
      "locales/fr.json": json({
        title: "Titre",
      }),
      "src/App.tsx": `import { useTranslation } from "react-i18next";
export function App() {
  const { t } = useTranslation();
  return <span>{t("title")}</span>;
}
`,
    });

    const h = harness(root);
    await h.start();

    const en = h.diagnosticsFor("locales/en.json");

    // unused suppressed for ignored key
    expect(find(en, "unused-key", "SERVER_X")).toBeUndefined();

    // locale gap must still be reported on the base catalog entry
    const missing = find(en, "missing-translation", "SERVER_X");
    expect(missing).toBeDefined();
    expect(missing?.message).toMatch(/fr/i);
  }, 60_000);
});
