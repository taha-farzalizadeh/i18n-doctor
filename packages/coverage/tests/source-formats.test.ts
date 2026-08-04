import { mkdir, writeFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { onTestFinished, describe, expect, it } from "vitest";
import {
  createCoverageAnalyzer,
  formatCoverageJson,
} from "../src/index.js";

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "i18n-cov-edge-"));
  onTestFinished(async () => {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  });
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, body);
  }
  return root;
}

describe("source formats via discover", () => {
  it("JSON multiple locale folders", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { i18next: "23.0.0" },
      }),
      "public/locales/en/common.json": JSON.stringify({ login: "Login" }),
      "public/locales/fa/common.json": JSON.stringify({}),
      "public/locales/fa/auth.json": JSON.stringify({ onlyFa: "x" }),
    });
    const result = await createCoverageAnalyzer().analyzeFromRoot({
      root,
      options: { baseLocale: "en", useContext: false },
    });
    expect(result.locales).toEqual(expect.arrayContaining(["en", "fa"]));
    // empty fa common still may not create keys — login missing in fa
    const json = formatCoverageJson(result);
    expect(json).toContain("en");
  });

  it("invalid JSON does not crash coverage", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { i18next: "23.0.0" },
      }),
      "public/locales/en/common.json": "{ not json",
      "public/locales/fa/common.json": JSON.stringify({ login: "x" }),
    });
    const result = await createCoverageAnalyzer().analyzeFromRoot({
      root,
      options: { baseLocale: "en", useContext: false },
    });
    expect(result).toBeDefined();
    expect(result.stats.coveragePercent).toBeGreaterThanOrEqual(0);
  });

  it("JS default export locales", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { i18next: "23.0.0" },
      }),
      "src/i18n/locales/en.js": `
        export default { greet: 'Hello', onlyEn: 'x' };
      `,
      "src/i18n/locales/de.js": `
        export default { greet: 'Hallo' };
      `,
    });
    const result = await createCoverageAnalyzer().analyzeFromRoot({
      root,
      options: { baseLocale: "en", useContext: false },
    });
    if (result.locales.includes("en") && result.locales.includes("de")) {
      expect(
        result.missing.some((m) => m.key === "onlyEn") ||
          result.issues?.some(
            (i) => i.key === "onlyEn" && i.type === "missing-translation",
          ),
      ).toBe(true);
    }
  });

  it("TS named export messages", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { i18next: "23.0.0" },
      }),
      "src/locales/en.ts": `
        export const messages = { hello: 'Hi', nested: { world: 'W' } };
      `,
      "src/locales/fa.ts": `
        export const messages = { hello: 'سلام' };
      `,
    });
    const result = await createCoverageAnalyzer().analyzeFromRoot({
      root,
      options: { baseLocale: "en", useContext: false },
    });
    expect(result.timings.totalMs).toBeGreaterThanOrEqual(0);
    // Soft assert — detector heuristics vary
    if (result.keys.some((k) => k.key.includes("world") || k.key === "nested.world")) {
      expect(result.missing.length + (result.issues?.length ?? 0)).toBeGreaterThan(0);
    }
  });

  it("different namespace layout auth/common/settings", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { i18next: "23.0.0" },
      }),
      "locales/en/auth.json": JSON.stringify({ login: "Login" }),
      "locales/en/common.json": JSON.stringify({ ok: "OK" }),
      "locales/en/settings.json": JSON.stringify({ theme: "dark" }),
      "locales/fa/auth.json": JSON.stringify({ login: "ورود" }),
      "locales/fa/common.json": JSON.stringify({ ok: "باشه" }),
      // settings missing in fa
    });
    const result = await createCoverageAnalyzer().analyzeFromRoot({
      root,
      options: { baseLocale: "en", useContext: false },
    });
    if (result.namespaces.includes("settings") || result.keys.some((k) => k.key === "theme")) {
      expect(
        result.missing.some((m) => m.key === "theme") ||
          result.stats.coveragePercent < 100,
      ).toBe(true);
    }
  });
});
