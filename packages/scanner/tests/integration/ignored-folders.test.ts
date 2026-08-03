import { describe, expect, it } from "vitest";
import { createScanner } from "../../src/index.js";
import { asRelativePosixPath } from "../../src/domain/brands.js";
import {
  hasPath,
  relativePaths,
  scanRoot,
  withFixture,
  writeTree,
} from "../helpers/fixture.js";

describe("ignored folders", () => {
  it("prunes builtin ignored directories and does not emit their files", async () => {
    await withFixture(
      async (root) =>
        writeTree(root, [
          { path: "package.json", content: JSON.stringify({ name: "ignores" }) },
          { path: "src/index.ts", content: "export {};\n" },
          { path: "node_modules/lodash/lodash.js", content: "module.exports=1;\n" },
          { path: "dist/main.js", content: "/* build */\n" },
          { path: "coverage/lcov.info", content: "TN:\n" },
          { path: ".next/server.js", content: "/* next */\n" },
          { path: ".nuxt/app.js", content: "/* nuxt */\n" },
          { path: "build/out.js", content: "/* build */\n" },
          { path: ".turbo/cache.json", content: "{}\n" },
          { path: ".cache/tmp.json", content: "{}\n" },
        ]),
      async (root) => {
        const snapshot = await scanRoot(root);
        const paths = relativePaths(snapshot);
        expect(paths).toEqual(["package.json", "src/index.ts"]);
        expect(paths.some((p) => p.includes("node_modules"))).toBe(false);
        expect(paths.some((p) => p.startsWith("dist/"))).toBe(false);
        expect(paths.some((p) => p.startsWith("coverage/"))).toBe(false);
      },
    );
  });

  it("honors .gitignore patterns and nested package gitignores", async () => {
    await withFixture(
      async (root) =>
        writeTree(root, [
          { path: "package.json", content: JSON.stringify({ name: "gitignore-app" }) },
          { path: ".gitignore", content: "secret.ts\ngenerated/\n" },
          { path: "src/index.ts", content: "export {};\n" },
          { path: "secret.ts", content: "export const secret = true;\n" },
          { path: "generated/a.ts", content: "export {};\n" },
          { path: "packages/web/package.json", content: JSON.stringify({ name: "web" }) },
          { path: "packages/web/.gitignore", content: "local.ts\n" },
          { path: "packages/web/src/ok.ts", content: "export {};\n" },
          { path: "packages/web/local.ts", content: "export {};\n" },
        ]),
      async (root) => {
        const snapshot = await scanRoot(root, { packages: ["."] });
        expect(hasPath(snapshot, "src/index.ts")).toBe(true);
        expect(hasPath(snapshot, "secret.ts")).toBe(false);
        expect(hasPath(snapshot, "generated/a.ts")).toBe(false);
        expect(hasPath(snapshot, "packages/web/src/ok.ts")).toBe(true);
        expect(hasPath(snapshot, "packages/web/local.ts")).toBe(false);
      },
    );
  });

  it("explainIgnored reports builtin and gitignore decisions", async () => {
    await withFixture(
      async (root) =>
        writeTree(root, [
          { path: "package.json", content: JSON.stringify({ name: "explain" }) },
          { path: ".gitignore", content: "*.tmp.ts\n" },
          { path: "src/index.ts", content: "export {};\n" },
        ]),
      async (root) => {
        const scanner = createScanner({ config: { root } });
        const plan = await scanner.buildPlan({ root });
        const nodeModules = scanner.explainIgnored(
          plan,
          asRelativePosixPath("node_modules"),
        );
        expect(nodeModules.ignored).toBe(true);

        const tmp = scanner.explainIgnored(plan, asRelativePosixPath("foo.tmp.ts"));
        expect(tmp.ignored).toBe(true);

        const source = scanner.explainIgnored(plan, asRelativePosixPath("src/index.ts"));
        expect(source.ignored).toBe(false);
      },
    );
  });

  it("can disable builtin ignores when explicitly configured", async () => {
    await withFixture(
      async (root) =>
        writeTree(root, [
          { path: "package.json", content: JSON.stringify({ name: "no-defaults" }) },
          { path: "dist/keep.js", content: "export {};\n" },
          { path: "src/index.ts", content: "export {};\n" },
        ]),
      async (root) => {
        const snapshot = await scanRoot(root, {
          ignoreDefaults: false,
          useGitIgnore: false,
          packages: ["."],
        });
        expect(hasPath(snapshot, "dist/keep.js")).toBe(true);
      },
    );
  });
});
