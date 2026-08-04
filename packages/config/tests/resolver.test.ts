import { describe, expect, it } from "vitest";
import { project } from "./helpers.js";

describe("EffectiveConfigResolver", () => {
  it("merges defaults < package.json < config file < CLI", () => {
    const { resolver, root } = project({
      "package.json": JSON.stringify({
        name: "app",
        "i18n-doctor": {
          ignoreKeys: ["from-pkg"],
          exitOnError: false,
        },
      }),
      "i18n-doctor.config.json": JSON.stringify({
        ignoreKeys: ["from-file"],
        ignoreFiles: ["**/vendor/**"],
        rules: { "missing-key": "warning" },
      }),
    });

    const effective = resolver.resolve({
      root,
      cli: {
        ignoreKeys: ["from-cli"],
        failOnWarning: true,
      },
    });

    expect(effective.ignoreKeys).toEqual(["from-cli"]);
    expect(effective.ignoreFiles).toEqual(["**/vendor/**"]);
    expect(effective.exit.exitOnError).toBe(false);
    expect(effective.exit.failOnWarning).toBe(true);
    expect(effective.rules.getSeverity("missing-key")).toBe("warning");
    expect(effective.fieldSources.ignoreKeys).toBe("cli");
    expect(effective.fieldSources.ignoreFiles).toBe("config-file");
  });

  it("is deterministic across repeated resolves", () => {
    const { resolver, root } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n-doctor.config.json": JSON.stringify({
        ignoreKeys: ["a.*", "b.*"],
        rules: { "unused-key": "error", "duplicate-key": "info" },
      }),
    });

    const a = resolver.resolve({ root });
    const b = resolver.resolve({ root });
    expect(a.ignoreKeys).toEqual(b.ignoreKeys);
    expect(a.rules.severities).toEqual(b.rules.severities);
    expect(a.fieldSources).toEqual(b.fieldSources);
    expect(a.exit.exitCode({ error: 1, warning: 0 })).toBe(1);
    expect(a.exit.exitCode({ error: 0, warning: 2 })).toBe(0);
  });

  it("supports monorepo package overrides", () => {
    const { resolver, root } = project({
      "package.json": JSON.stringify({
        name: "root",
        workspaces: ["packages/*"],
        "i18n-doctor": {
          ignoreKeys: ["root.*"],
          rules: { "unused-key": "warning" },
        },
      }),
      "i18n-doctor.config.json": JSON.stringify({
        ignoreFiles: ["**/dist/**"],
      }),
      "packages/web/package.json": JSON.stringify({ name: "web" }),
      "packages/web/i18n-doctor.config.json": JSON.stringify({
        ignoreKeys: ["web.*"],
        rules: { "unused-key": "error" },
      }),
      "packages/api/package.json": JSON.stringify({ name: "api" }),
    });

    const all = resolver.resolveMonorepo({ root });
    const web = all.find((c) => (c.packageRoot ?? "").includes("packages/web"));
    const api = all.find((c) => (c.packageRoot ?? "").includes("packages/api"));

    expect(web?.ignoreKeys).toEqual(["web.*"]);
    expect(web?.rules.getSeverity("unused-key")).toBe("error");
    expect(web?.ignoreFiles).toEqual(["**/dist/**"]);

    // api inherits root package.json ignoreKeys
    expect(api?.ignoreKeys).toEqual(["root.*"]);
    expect(api?.rules.getSeverity("unused-key")).toBe("warning");
  });

  it("CLI overrides package config", () => {
    const { resolver, root } = project({
      "package.json": JSON.stringify({ name: "app" }),
      "i18n-doctor.config.json": JSON.stringify({
        output: { format: "terminal" },
      }),
    });

    const effective = resolver.resolve({
      root,
      cli: { output: { format: "json", verbose: true } },
    });
    expect(effective.output.format).toBe("json");
    expect(effective.output.verbose).toBe(true);
    expect(effective.fieldSources["output.format"]).toBe("cli");
  });
});
