import { describe, expect, it } from "vitest";
import {
  inferLocaleFromPath,
  looksLikeLocale,
  looksLikeLocaleMap,
} from "../src/internal/locale.js";
import { inferNamespaceFromPath } from "../src/internal/namespace.js";

describe("locale / namespace inference", () => {
  it("infers locale and namespace from common layouts", () => {
    expect(inferLocaleFromPath("public/locales/en/common.json")).toBe("en");
    expect(inferNamespaceFromPath("public/locales/en/common.json")).toBe(
      "common",
    );
    expect(inferLocaleFromPath("messages/en-US.json")).toBe("en-US");
    expect(inferNamespaceFromPath("messages/en-US.json")).toBeUndefined();
    expect(inferNamespaceFromPath("locales/en/translation.json")).toBe(
      "translation",
    );
    expect(inferNamespaceFromPath("locales/common/en.json")).toBe("common");
  });

  it("rejects ambiguous short tokens outside i18n context", () => {
    expect(inferLocaleFromPath("src/lib/util.ts")).toBeUndefined();
    expect(looksLikeLocale("src", "loose")).toBe(false);
    expect(looksLikeLocale("app", "strict")).toBe(false);
  });

  it("detects locale maps conservatively", () => {
    expect(looksLikeLocaleMap(["en", "fr"])).toBe(true);
    expect(looksLikeLocaleMap(["en", "translation"])).toBe(false);
    expect(looksLikeLocaleMap(["foo", "bar"])).toBe(false);
    expect(looksLikeLocaleMap(["xx-YY", "zz-AA"])).toBe(true);
  });
});
