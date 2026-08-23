import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { find, harness, underlined } from "./helpers.js";

const DEMO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../examples/demo-project",
);

/**
 * Guards the documented example: the table in `examples/README.md` is only
 * trustworthy if the shipped project really produces those diagnostics.
 */
describe("examples/demo-project", () => {
  it("reports the documented missing key in Login.tsx", async () => {
    const h = harness(DEMO);
    await h.start();

    const diagnostic = find(h.diagnosticsFor("src/Login.tsx"), "missing-key");
    expect(diagnostic?.message).toBe(
      'Translation key "auth:nonexistent" does not exist.',
    );

    const text = await readFile(path.join(DEMO, "src", "Login.tsx"), "utf8");
    expect(underlined(text, diagnostic!)).toBe('"nonexistent"');
  });

  it("reports the documented findings on the auth catalog", async () => {
    const h = harness(DEMO);
    await h.start();

    const codes = h.codesFor("public/locales/en/auth.json");
    expect(codes).toContain("unused-key");
    expect(codes).toContain("missing-translation");

    expect(
      find(
        h.diagnosticsFor("public/locales/en/auth.json"),
        "unused-key",
        "forgotten",
      )?.message,
    ).toBe('Unused translation key "auth:forgotten" — defined but never used.');
    expect(
      find(
        h.diagnosticsFor("public/locales/en/auth.json"),
        "missing-translation",
        "forgotten",
      )?.message,
    ).toBe('Translation key "auth:forgotten" is missing in locale "fa".');
  });

  it("keeps the settings namespace clean", async () => {
    const h = harness(DEMO);
    await h.start();

    expect(h.diagnosticsFor("src/Settings.tsx")).toEqual([]);
    expect(h.diagnosticsFor("public/locales/en/settings.json")).toEqual([]);
    expect(h.diagnosticsFor("public/locales/fa/settings.json")).toEqual([]);
  });

  it("reads languageServer settings from the package.json block", async () => {
    const h = harness(DEMO, { respectConfig: true });
    await h.start();

    expect(h.core.settings()?.debounce).toBe(250);
    expect(h.core.settings()?.logLevel).toBe("error");
  });
});
