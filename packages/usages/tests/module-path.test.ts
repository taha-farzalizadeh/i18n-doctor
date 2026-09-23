import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  findIndexKey,
  loadAliasPathMap,
  resolveModuleSpec,
  setModuleResolveRoot,
} from "../src/internal/module-path.js";
import { fixture } from "./helpers.js";

describe("module-path Windows / Vite hardening", () => {
  it("normalizes backslash fromFileRel for relative imports", () => {
    setModuleResolveRoot(undefined);
    const bases = resolveModuleSpec(
      "src\\app\\pages\\datasets\\FilterDrawer.tsx",
      "./validation",
    );
    expect(bases).toEqual(["src/app/pages/datasets/validation"]);
  });

  it("loads paths from tsconfig.app.json when root tsconfig has none", async () => {
    const root = await fixture({
      "tsconfig.json": JSON.stringify({
        files: [],
        references: [{ path: "./tsconfig.app.json" }],
      }),
      "tsconfig.app.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "app/*": ["./src/app/*"],
            "@core/*": ["./src/@core/*"],
          },
        },
      }),
    });
    const map = loadAliasPathMap(root);
    expect(map?.paths.get("app/*")).toEqual(["./src/app/*"]);
    expect(map?.paths.get("@core/*")).toEqual(["./src/@core/*"]);

    setModuleResolveRoot(root);
    const bases = resolveModuleSpec(
      "src/app/pages/x.tsx",
      "app/pages/datasets/validation",
    );
    expect(bases).toEqual(["src/app/pages/datasets/validation"]);
    setModuleResolveRoot(undefined);
  });

  it("loads paths from tsconfig with UTF-8 BOM (Windows editors)", async () => {
    const root = await fixture({
      "tsconfig.json":
        "\uFEFF" +
        JSON.stringify({
          compilerOptions: {
            baseUrl: ".",
            paths: { "app/*": ["./src/app/*"] },
          },
        }),
    });
    const map = loadAliasPathMap(root);
    expect(map?.paths.get("app/*")).toEqual(["./src/app/*"]);
  });

  it("loads paths via extends", async () => {
    const root = await fixture({
      "tsconfig.json": JSON.stringify({ extends: "./tsconfig.app.json" }),
      "tsconfig.app.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@/*": ["./src/*"] },
        },
      }),
    });
    const map = loadAliasPathMap(root);
    expect(map?.paths.size).toBe(1);
    expect(map?.paths.get("@/*")).toEqual(["./src/*"]);
  });

  it("findIndexKey matches case-insensitively", () => {
    const index = new Map([
      ["src/App/Validation.ts#schema", { paramIndex: 0, paramName: "t" }],
    ]);
    const hit = findIndexKey(index, "src/app/validation.ts", "schema");
    expect(hit?.key).toBe("src/App/Validation.ts#schema");
    expect(hit?.value.paramName).toBe("t");
  });

  it("resolveModuleSpec joins with posix even when root uses platform sep", async () => {
    const root = await fixture({
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "app/*": ["./src/app/*"] },
        },
      }),
    });
    setModuleResolveRoot(root);
    const from = ["src", "app", "pages", "Drawer.tsx"].join(path.sep);
    const bases = resolveModuleSpec(from, "app/pages/datasets/validation");
    expect(bases).toEqual(["src/app/pages/datasets/validation"]);
    setModuleResolveRoot(undefined);
  });
});
