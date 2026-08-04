import { describe, expect, it } from "vitest";
import {
  createIgnoreEngine,
  createSuppressionEngine,
} from "../src/index.js";
import { project } from "./helpers.js";

describe("production config scenarios", () => {
  describe("config loading", () => {
    it("loads package.json i18n-unused", () => {
      const { resolver, root } = project({
        "package.json": JSON.stringify({
          name: "app",
          "i18n-unused": {
            ignoreKeys: ["pkg.*"],
            ignoreNamespaces: ["test"],
            ignoreLocales: ["pseudo"],
          },
        }),
      });
      const e = resolver.resolve({ root });
      expect(e.ignoreKeys).toEqual(["pkg.*"]);
      expect(e.ignoreNamespaces).toEqual(["test"]);
      expect(e.ignoreLocales).toEqual(["pseudo"]);
      expect(e.fieldSources.ignoreKeys).toBe("package-json");
    });

    it("prefers config file over package.json", () => {
      const { resolver, root } = project({
        "package.json": JSON.stringify({
          name: "app",
          "i18n-unused": { ignoreKeys: ["from-pkg"] },
        }),
        "i18n-unused.config.json": JSON.stringify({
          ignoreKeys: ["from-file"],
        }),
      });
      const e = resolver.resolve({ root });
      expect(e.ignoreKeys).toEqual(["from-file"]);
      expect(e.fieldSources.ignoreKeys).toBe("config-file");
    });

    it("honors config file priority (.ts before .json)", () => {
      const { loader } = project({
        "package.json": JSON.stringify({ name: "app" }),
        "i18n-unused.config.ts": `export default { ignoreKeys: ['ts'] };`,
        "i18n-unused.config.json": JSON.stringify({ ignoreKeys: ["json"] }),
      });
      const loaded = loader.load();
      expect(loaded.configPath).toContain(".ts");
      expect(
        loaded.fragments.find((f) => f.source === "config-file")?.config
          .ignoreKeys,
      ).toEqual(["ts"]);
    });

    it("explicit configPath skips auto-discovery", () => {
      const { resolver, root } = project({
        "package.json": JSON.stringify({ name: "app" }),
        "custom.json": JSON.stringify({ ignoreKeys: ["custom"] }),
        "i18n-unused.config.json": JSON.stringify({ ignoreKeys: ["auto"] }),
      });
      const e = resolver.resolve({
        root,
        configPath: "custom.json",
      });
      expect(e.ignoreKeys).toEqual(["custom"]);
      expect(
        e.fragments.some((f) => f.path?.includes("i18n-unused.config")),
      ).toBe(false);
    });

    it("reports config-not-found for missing configPath", () => {
      const { resolver, root } = project({
        "package.json": JSON.stringify({ name: "app" }),
      });
      const e = resolver.resolve({
        root,
        configPath: "missing.json",
      });
      expect(e.diagnostics.some((d) => d.code === "config-not-found")).toBe(
        true,
      );
    });
  });

  describe("ignore patterns", () => {
    it("ignore keys / namespaces / locales / files", () => {
      const engine = createIgnoreEngine({
        ignoreKeys: ["debug.*", "tmp"],
        ignoreNamespaces: ["storybook", "test-*"],
        ignoreLocales: ["pseudo", "en-XA"],
        ignoreFiles: ["**/generated/**", "*.stories.tsx"],
        include: ["src/**"],
        exclude: ["**/*.test.ts"],
      });

      expect(engine.isKeyIgnored("debug.x").ignored).toBe(true);
      expect(engine.isKeyIgnored("nav.home").ignored).toBe(false);
      // no basename fallback for keys
      expect(engine.isKeyIgnored("x/debug.foo").ignored).toBe(false);

      expect(engine.isNamespaceIgnored("storybook").ignored).toBe(true);
      expect(engine.isNamespaceIgnored("test-a").ignored).toBe(true);
      expect(engine.isNamespaceIgnored("common").ignored).toBe(false);

      expect(engine.isLocaleIgnored("pseudo").ignored).toBe(true);
      expect(engine.isLocaleIgnored("en").ignored).toBe(false);

      expect(engine.isFileIgnored("src/generated/a.ts").ignored).toBe(true);
      expect(engine.isFileIgnored("foo/generatedbar").ignored).toBe(false);
      expect(engine.isFileIgnored("src/Btn.stories.tsx").ignored).toBe(true);

      expect(engine.shouldAnalyzeFile("src/App.tsx").ignored).toBe(false);
      expect(engine.shouldAnalyzeFile("src/App.test.ts").ignored).toBe(true);
      expect(engine.shouldAnalyzeFile("lib/x.ts").ignored).toBe(true);
    });
  });

  describe("inline suppression", () => {
    const engine = createSuppressionEngine();

    it("inline ignore on same line", () => {
      const file = engine.parseFile({
        absolutePath: "/a.ts",
        relativePath: "a.ts",
        sourceText: `t('a'); // i18n-unused-ignore\n`,
      });
      expect(engine.isSuppressed(file, { line: 1 }).suppressed).toBe(true);
    });

    it("ignore-next-line", () => {
      const file = engine.parseFile({
        absolutePath: "/a.ts",
        relativePath: "a.ts",
        sourceText: `/* i18n-unused-ignore-next-line */\nt('a');\n`,
      });
      expect(engine.isSuppressed(file, { line: 2 }).suppressed).toBe(true);
    });

    it("disable / enable regions", () => {
      const file = engine.parseFile({
        absolutePath: "/a.ts",
        relativePath: "a.ts",
        sourceText: `
/* i18n-unused-disable */
t('a');
/* i18n-unused-enable */
t('b');
`,
      });
      expect(engine.isSuppressed(file, { line: 3 }).suppressed).toBe(true);
      expect(engine.isSuppressed(file, { line: 5 }).suppressed).toBe(false);
    });

    it("does not treat string literals as directives", () => {
      const file = engine.parseFile({
        absolutePath: "/a.ts",
        relativePath: "a.ts",
        sourceText: `const s = "// i18n-unused-ignore";\nt('a');\n`,
      });
      expect(engine.isSuppressed(file, { line: 1 }).suppressed).toBe(false);
      expect(engine.isSuppressed(file, { line: 2 }).suppressed).toBe(false);
    });

    it("unknown rule names do not widen to all rules", () => {
      const file = engine.parseFile({
        absolutePath: "/a.ts",
        relativePath: "a.ts",
        sourceText: `t('a'); // i18n-unused-ignore not-a-real-rule\n`,
      });
      expect(
        engine.isSuppressed(file, { line: 1, rule: "unused-key" }).suppressed,
      ).toBe(false);
    });

    it("supports multi-line block comment star continuations", () => {
      const file = engine.parseFile({
        absolutePath: "/a.ts",
        relativePath: "a.ts",
        sourceText: `
/*
 * i18n-unused-disable
 */
t('a');
/*
 * i18n-unused-enable
 */
`,
      });
      expect(engine.isSuppressed(file, { line: 5 }).suppressed).toBe(true);
    });
  });

  describe("CLI overrides & invalid config", () => {
    it("CLI overrides config file", () => {
      const { resolver, root } = project({
        "package.json": JSON.stringify({ name: "app" }),
        "i18n-unused.config.json": JSON.stringify({
          ignoreKeys: ["file"],
          exitOnError: true,
        }),
      });
      const e = resolver.resolve({
        root,
        cli: { ignoreKeys: ["cli"], exitOnError: false },
      });
      expect(e.ignoreKeys).toEqual(["cli"]);
      expect(e.exit.exitOnError).toBe(false);
      expect(e.fieldSources.ignoreKeys).toBe("cli");
    });

    it("validates CLI boolean rule severities", () => {
      const { resolver, root } = project({
        "package.json": JSON.stringify({ name: "app" }),
      });
      const e = resolver.resolve({
        root,
        cli: { rules: { "unused-key": false } },
      });
      expect(e.rules.getSeverity("unused-key")).toBe("off");
      expect(e.rules.isEnabled("unused-key")).toBe(false);
    });

    it("emits clear diagnostics for invalid configuration", () => {
      const { loader } = project({
        "package.json": JSON.stringify({ name: "app" }),
        "i18n-unused.config.json": JSON.stringify({
          ignoreKeys: 123,
          mystery: true,
          rules: { "unused-key": "nope" },
        }),
      });
      const loaded = loader.load();
      const codes = loaded.diagnostics.map((d) => d.code).sort();
      expect(codes).toContain("config-invalid-type");
      expect(codes).toContain("config-unknown-key");
      expect(codes).toContain("config-invalid-severity");
      expect(
        loaded.diagnostics.find((d) => d.code === "config-invalid-type")
          ?.message,
      ).toMatch(/received/);
    });

    it("warns when both rules and severities are set", () => {
      const { loader } = project({
        "package.json": JSON.stringify({ name: "app" }),
        "i18n-unused.config.json": JSON.stringify({
          rules: { "unused-key": "error" },
          severities: { "unused-key": "warning" },
        }),
      });
      const loaded = loader.load();
      expect(
        loaded.diagnostics.some((d) => d.code === "config-duplicate-rules-key"),
      ).toBe(true);
      expect(
        loaded.fragments.find((f) => f.source === "config-file")?.config.rules?.[
          "unused-key"
        ],
      ).toBe("error");
    });

    it("keeps static entries when array has dynamic values", () => {
      const { loader } = project({
        "package.json": JSON.stringify({ name: "app" }),
        "i18n-unused.config.js": `
          export default {
            ignoreKeys: ['static', process.env.X],
          };
        `,
      });
      const loaded = loader.load();
      const frag = loaded.fragments.find((f) => f.source === "config-file");
      expect(frag?.config.ignoreKeys).toEqual(["static"]);
    });
  });

  describe("monorepo / nested projects", () => {
    it("package package.json beats root config file", () => {
      const { resolver, root } = project({
        "package.json": JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
        }),
        "i18n-unused.config.json": JSON.stringify({
          ignoreKeys: ["root-file"],
        }),
        "packages/web/package.json": JSON.stringify({
          name: "web",
          "i18n-unused": { ignoreKeys: ["web-pkg"] },
        }),
      });
      const all = resolver.resolveMonorepo({ root });
      const web = all.find((c) =>
        (c.packageRoot ?? "").includes("packages/web"),
      );
      expect(web?.ignoreKeys).toEqual(["web-pkg"]);
      expect(web?.fieldSources.ignoreKeys).toBe("package-config");
    });

    it("package config file beats package package.json", () => {
      const { resolver, root } = project({
        "package.json": JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
        }),
        "packages/web/package.json": JSON.stringify({
          name: "web",
          "i18n-unused": { ignoreKeys: ["web-pkg"] },
        }),
        "packages/web/i18n-unused.config.json": JSON.stringify({
          ignoreKeys: ["web-file"],
        }),
      });
      const all = resolver.resolveMonorepo({ root });
      const web = all.find((c) =>
        (c.packageRoot ?? "").includes("packages/web"),
      );
      expect(web?.ignoreKeys).toEqual(["web-file"]);
    });

    it("uses config packages field for discovery", () => {
      const { resolver, root } = project({
        "package.json": JSON.stringify({ name: "root" }),
        "i18n-unused.config.json": JSON.stringify({
          packages: ["custom-pkgs/*"],
        }),
        "custom-pkgs/a/package.json": JSON.stringify({ name: "a" }),
        "custom-pkgs/a/i18n-unused.config.json": JSON.stringify({
          ignoreKeys: ["a.*"],
        }),
        "packages/b/package.json": JSON.stringify({ name: "b" }),
      });
      const all = resolver.resolveMonorepo({ root });
      expect(
        all.some((c) => (c.packageRoot ?? "").includes("custom-pkgs/a")),
      ).toBe(true);
      // packages/b not discovered when packages field is set
      expect(
        all.some((c) => (c.packageRoot ?? "").includes("packages/b")),
      ).toBe(false);
    });

    it("supports exact workspace package paths", () => {
      const { resolver, root } = project({
        "package.json": JSON.stringify({
          name: "root",
          workspaces: ["libs/core"],
        }),
        "libs/core/package.json": JSON.stringify({ name: "core" }),
        "libs/core/i18n-unused.config.json": JSON.stringify({
          ignoreKeys: ["core.*"],
        }),
      });
      const all = resolver.resolveMonorepo({ root });
      const core = all.find((c) =>
        (c.packageRoot ?? "").includes("libs/core"),
      );
      expect(core?.ignoreKeys).toEqual(["core.*"]);
    });

    it("normalizes relative paths to POSIX", () => {
      const engine = createIgnoreEngine({
        ignoreFiles: ["src/generated/**"],
      });
      expect(engine.isFileIgnored("src\\generated\\a.ts").ignored).toBe(true);
      expect(engine.shouldAnalyzeFile("./src/generated/a.ts").ignored).toBe(
        true,
      );
    });
  });

  describe("determinism", () => {
    it("stable precedence and diagnostics order", () => {
      const { resolver, root } = project({
        "package.json": JSON.stringify({
          name: "app",
          "i18n-unused": { ignoreKeys: ["a"], mystery: 1 },
        }),
        "i18n-unused.config.json": JSON.stringify({
          ignoreKeys: ["b"],
          alsoUnknown: true,
        }),
      });
      const a = resolver.resolve({ root, cli: { ignoreKeys: ["c"] } });
      const b = resolver.resolve({ root, cli: { ignoreKeys: ["c"] } });
      expect(a.ignoreKeys).toEqual(["c"]);
      expect(a.ignoreKeys).toEqual(b.ignoreKeys);
      expect(a.fieldSources).toEqual(b.fieldSources);
      expect(a.diagnostics.map((d) => d.code)).toEqual(
        b.diagnostics.map((d) => d.code),
      );
    });
  });
});
