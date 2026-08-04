import { describe, expect, it } from "vitest";
import { project } from "./helpers.js";

describe("ConfigLoader", () => {
  it("loads i18n-doctor.config.json", () => {
    const { loader } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n-doctor.config.json": JSON.stringify({
        ignoreKeys: ["debug.*"],
        ignoreFiles: ["**/generated/**"],
        rules: { "unused-key": "error" },
      }),
    });

    const loaded = loader.load();
    expect(loaded.configPath).toContain("i18n-doctor.config.json");
    const frag = loaded.fragments.find((f) => f.source === "config-file");
    expect(frag?.config.ignoreKeys).toEqual(["debug.*"]);
    expect(frag?.config.rules?.["unused-key"]).toBe("error");
  });

  it("loads package.json i18n-doctor field", () => {
    const { loader } = project({
      "package.json": JSON.stringify({
        name: "app",
        "i18n-doctor": {
          ignoreLocales: ["pseudo"],
          exitOnError: false,
        },
      }),
    });

    const loaded = loader.load();
    const frag = loaded.fragments.find((f) => f.source === "package-json");
    expect(frag?.config.ignoreLocales).toEqual(["pseudo"]);
    expect(frag?.config.exitOnError).toBe(false);
  });

  it("statically parses i18n-doctor.config.ts export default", () => {
    const { loader } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n-doctor.config.ts": `
        export default {
          ignoreKeys: ['legacy.*'],
          ignoreNamespaces: ['test'],
          output: { format: 'json', color: false },
        };
      `,
    });

    const loaded = loader.load();
    const frag = loaded.fragments.find((f) => f.source === "config-file");
    expect(frag?.config.ignoreKeys).toEqual(["legacy.*"]);
    expect(frag?.config.ignoreNamespaces).toEqual(["test"]);
    expect(frag?.config.output?.format).toBe("json");
  });

  it("parses module.exports in .cjs", () => {
    const { loader } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n-doctor.config.cjs": `
        module.exports = {
          exclude: ['**/*.stories.tsx'],
          failOnWarning: true,
        };
      `,
    });

    const loaded = loader.load();
    const frag = loaded.fragments.find((f) => f.source === "config-file");
    expect(frag?.config.exclude).toEqual(["**/*.stories.tsx"]);
    expect(frag?.config.failOnWarning).toBe(true);
  });

  it("reports validation diagnostics for invalid types", () => {
    const { loader } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n-doctor.config.json": JSON.stringify({
        ignoreKeys: "not-an-array",
        unknownOption: true,
        rules: { "unused-key": "banana" },
      }),
    });

    const loaded = loader.load();
    const codes = loaded.diagnostics.map((d) => d.code);
    expect(codes).toContain("config-invalid-type");
    expect(codes).toContain("config-unknown-key");
    expect(codes).toContain("config-invalid-severity");
  });

  it("does not execute dynamic config values", () => {
    const { loader } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n-doctor.config.js": `
        export default {
          ignoreKeys: process.env.KEYS.split(','),
          include: ['src/**'],
        };
      `,
    });

    const loaded = loader.load();
    const frag = loaded.fragments.find((f) => f.source === "config-file");
    expect(frag?.config.ignoreKeys).toBeUndefined();
    expect(frag?.config.include).toEqual(["src/**"]);
    expect(
      frag?.diagnostics.some((d) => d.code === "config-dynamic-value"),
    ).toBe(true);
  });

  it("prefers first matching config filename in order", () => {
    const { loader } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n-doctor.config.ts": `export default { ignoreKeys: ['from-ts'] };`,
      "i18n-doctor.config.json": JSON.stringify({ ignoreKeys: ["from-json"] }),
    });

    const loaded = loader.load();
    expect(loaded.configPath).toContain(".ts");
    const frag = loaded.fragments.find((f) => f.source === "config-file");
    expect(frag?.config.ignoreKeys).toEqual(["from-ts"]);
  });
});
