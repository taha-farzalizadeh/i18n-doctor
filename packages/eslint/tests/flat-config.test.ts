import { describe, expect, it } from "vitest";
import i18nDoctor, { recommendedRules } from "../src/index.js";

describe("flat config preset", () => {
  it("exports configs.recommended as a flat config array", () => {
    expect(Array.isArray(i18nDoctor.configs.recommended)).toBe(true);
    expect(i18nDoctor.configs.recommended.length).toBeGreaterThanOrEqual(2);
    const entry = i18nDoctor.configs.recommended[0]!;
    expect(entry.name).toBe("i18n-doctor/recommended");
    expect(entry.plugins?.["i18n-doctor"]).toBe(i18nDoctor);
    expect(entry.rules).toEqual(recommendedRules);
    const locales = i18nDoctor.configs.recommended[1]!;
    expect(locales.name).toBe("i18n-doctor/recommended-locales");
    expect(locales.files).toEqual(["**/*.json"]);
  });

  it("registers all five rule ids", () => {
    expect(Object.keys(i18nDoctor.rules).sort()).toEqual([
      "locale-consistency",
      "no-duplicate-key",
      "no-missing-key",
      "no-untranslated",
      "no-unused-key",
    ]);
  });

  it("documents schema and messages on every rule", () => {
    for (const rule of Object.values(i18nDoctor.rules)) {
      expect(rule.meta?.schema).toEqual([]);
      expect(Object.keys(rule.meta?.messages ?? {}).length).toBeGreaterThan(0);
      expect(rule.meta?.docs?.description).toBeTruthy();
    }
  });
});
