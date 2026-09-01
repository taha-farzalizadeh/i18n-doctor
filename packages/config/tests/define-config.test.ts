import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defineConfig, loadConfig } from "../src/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function writeProject(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-cfg-"));
  tempDirs.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, "utf8");
  }
  return root;
}

describe("defineConfig", () => {
  it("is a typed identity — returns the config unchanged", () => {
    const config = defineConfig({ ignoreKeys: ["SERVER_*", "BACKEND_*"] });
    expect(config).toEqual({ ignoreKeys: ["SERVER_*", "BACKEND_*"] });
  });

  it("accepts an empty config", () => {
    expect(defineConfig({})).toEqual({});
  });
});

describe("loadConfig — discovery", () => {
  it("returns the default config when no config file exists", async () => {
    const root = writeProject({
      "package.json": JSON.stringify({ name: "app" }),
    });

    const result = await loadConfig({ cwd: root });

    expect(result.cwd).toBe(root);
    expect(result.configPath).toBeUndefined();
    expect(result.config.ignoreKeys).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("discovers i18n-doctor.config.ts using defineConfig", async () => {
    const root = writeProject({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n-doctor.config.ts": `
        import { defineConfig } from "i18n-doctor";

        export default defineConfig({
          ignoreKeys: ["SERVER_*", "BACKEND_*"],
        });
      `,
    });

    const result = await loadConfig({ cwd: root });

    expect(result.configPath).toBe(path.join(root, "i18n-doctor.config.ts"));
    expect(result.config.ignoreKeys).toEqual(["SERVER_*", "BACKEND_*"]);
    expect(result.diagnostics).toEqual([]);
  });

  it("discovers i18n-doctor.config.js", async () => {
    const root = writeProject({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n-doctor.config.js": `
        export default { ignoreKeys: ["from-js"] };
      `,
    });

    const result = await loadConfig({ cwd: root });

    expect(result.configPath).toBe(path.join(root, "i18n-doctor.config.js"));
    expect(result.config.ignoreKeys).toEqual(["from-js"]);
  });

  it("discovers i18n-doctor.config.mjs", async () => {
    const root = writeProject({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n-doctor.config.mjs": `
        export default { ignoreKeys: ["from-mjs"] };
      `,
    });

    const result = await loadConfig({ cwd: root });

    expect(result.configPath).toBe(path.join(root, "i18n-doctor.config.mjs"));
    expect(result.config.ignoreKeys).toEqual(["from-mjs"]);
  });

  it("prefers .ts over .js/.mjs when several exist", async () => {
    const root = writeProject({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n-doctor.config.ts": `export default { ignoreKeys: ["from-ts"] };`,
      "i18n-doctor.config.mjs": `export default { ignoreKeys: ["from-mjs"] };`,
    });

    const result = await loadConfig({ cwd: root });

    expect(result.configPath).toBe(path.join(root, "i18n-doctor.config.ts"));
    expect(result.config.ignoreKeys).toEqual(["from-ts"]);
  });

  it("resolves the nearest package config from a nested cwd", async () => {
    const root = writeProject({
      "package.json": JSON.stringify({
        name: "mono",
        private: true,
        workspaces: ["packages/*"],
      }),
      "i18n-doctor.config.json": JSON.stringify({
        ignoreKeys: ["root.*"],
      }),
      "packages/web/package.json": JSON.stringify({ name: "web" }),
      "packages/web/i18n-doctor.config.ts": `
        import { defineConfig } from "i18n-doctor";
        export default defineConfig({ ignoreKeys: ["web.*"] });
      `,
    });

    const fromRoot = await loadConfig({ cwd: root });
    expect(fromRoot.config.ignoreKeys).toEqual(["root.*"]);

    const fromPackage = await loadConfig({
      cwd: path.join(root, "packages/web"),
    });
    expect(fromPackage.configPath).toBe(
      path.join(root, "packages/web/i18n-doctor.config.ts"),
    );
    expect(fromPackage.config.ignoreKeys).toEqual(["web.*"]);
  });
});

describe("loadConfig — validation", () => {
  it("rejects when cwd is missing", async () => {
    await expect(
      loadConfig(undefined as unknown as { cwd: string }),
    ).rejects.toThrow(TypeError);
  });

  it("surfaces a clear error for invalid config syntax", async () => {
    const root = writeProject({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n-doctor.config.ts": `
        export default { ignoreKeys: "not-an-array" };
      `,
    });

    const result = await loadConfig({ cwd: root });

    expect(result.configPath).toBe(path.join(root, "i18n-doctor.config.ts"));
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.path).toContain("i18n-doctor.config.ts");
  });

  it("never executes dynamic values in config files", async () => {
    const root = writeProject({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n-doctor.config.ts": `
        export default {
          ignoreKeys: globalThis.EXPLOIT,
        };
      `,
    });

    const result = await loadConfig({ cwd: root });

    // The dynamic expression is reported, not executed — ignoreKeys stays empty.
    expect(result.config.ignoreKeys).toEqual([]);
    expect(
      result.diagnostics.some(
        (d) =>
          d.code === "config-dynamic-value" || d.code === "config-object-not-found",
      ),
    ).toBe(true);
  });
});
