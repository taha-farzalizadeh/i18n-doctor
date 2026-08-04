import { describe, expect, it } from "vitest";
import type { LiteFileEntry } from "@i18n-doctor/scanner";
import { createSourceDetector } from "../src/index.js";
import { scoreCandidate } from "../src/internal/candidates.js";
import { inferLocaleFromPath, looksLikeLocale } from "../src/internal/locale.js";
import { fixture } from "./helpers.js";

function lite(
  relativePath: string,
  extension: string,
  role: LiteFileEntry["role"] = "source",
): LiteFileEntry {
  return {
    fileId: 1 as LiteFileEntry["fileId"],
    packageId: "" as LiteFileEntry["packageId"],
    relativePath: relativePath as LiteFileEntry["relativePath"],
    extension,
    language: "json",
    syntaxDomain: "resource",
    role,
    size: 10,
    mtimeMs: 0,
    flags: [],
    contentState: "unread",
  };
}

describe("edge cases", () => {
  it("keeps same key in different namespaces", async () => {
    const root = await fixture({
      "locales/en/common.json": JSON.stringify({ title: "Common" }),
      "locales/en/home.json": JSON.stringify({ title: "Home" }),
    });
    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });
    const titles = catalog.keys.filter((k) => k.key === "title");
    expect(titles).toHaveLength(2);
    expect(titles.map((t) => t.namespace).sort()).toEqual(["common", "home"]);
  });

  it("keeps same key in different locales", async () => {
    const root = await fixture({
      "locales/en/common.json": JSON.stringify({ title: "Hello" }),
      "locales/fr/common.json": JSON.stringify({ title: "Bonjour" }),
    });
    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });
    const titles = catalog.keys.filter((k) => k.key === "title");
    expect(titles).toHaveLength(2);
    expect(titles.map((t) => t.locale).sort()).toEqual(["en", "fr"]);
  });

  it("warns when the same key is duplicated in the same locale/namespace", async () => {
    const root = await fixture({
      "locales/en/common.json": JSON.stringify({ title: "A" }),
      "i18n/en/common.json": JSON.stringify({ title: "B" }),
    });
    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });
    const titles = catalog.keys.filter(
      (k) => k.key === "title" && k.locale === "en" && k.namespace === "common",
    );
    expect(titles.length).toBeGreaterThanOrEqual(2);
    expect(
      catalog.warnings.some((w) => w.code === "duplicate-key-definitions"),
    ).toBe(true);
  });

  it("accepts unknown but shaped locales in i18n paths", async () => {
    const root = await fixture({
      "messages/xx-YY.json": JSON.stringify({ hello: "X" }),
    });
    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });
    expect(catalog.sources[0]?.locale).toBe("xx-YY");
    expect(looksLikeLocale("xx-YY", "loose")).toBe(true);
    expect(looksLikeLocale("xx", "loose")).toBe(false);
  });

  it("does not treat src/app.json as a locale resource", () => {
    expect(scoreCandidate(lite("src/app.json", "json"))).toBeUndefined();
    expect(inferLocaleFromPath("src/app.json")).toBeUndefined();
    expect(inferLocaleFromPath("src/i18n.ts")).toBeUndefined();
  });

  it("skips generated files and folders", async () => {
    const root = await fixture({
      "locales/en.json": JSON.stringify({ ok: "OK" }),
      "dist/locales/en.json": JSON.stringify({ bad: "BAD" }),
      ".next/server/messages/en.json": JSON.stringify({ bad: "BAD" }),
      "generated/i18n/en.json": JSON.stringify({ bad: "BAD" }),
    });
    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });
    expect(catalog.sources.every((s) => s.filePath === "locales/en.json")).toBe(
      true,
    );
    expect(catalog.keys.some((k) => k.key === "bad")).toBe(false);
  });

  it("skips scanner role=generated candidates", () => {
    expect(
      scoreCandidate(lite("locales/en.json", "json", "generated")),
    ).toBeUndefined();
  });

  it("never throws on empty projects", async () => {
    const root = await fixture({});
    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });
    expect(catalog.keys).toEqual([]);
  });
});
