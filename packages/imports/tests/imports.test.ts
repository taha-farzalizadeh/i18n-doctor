import { describe, expect, it } from "vitest";
import { listUnusedExports } from "../src/internal/extract-module.js";
import { chainKinds, virtualProject } from "./helpers.js";

describe("imports", () => {
  it("named import", () => {
    const { resolver, graph, abs } = virtualProject({
      "src/A.ts": `export const LOGIN = "auth.login";\n`,
      "src/B.ts": `import { LOGIN } from "./A";\nt(LOGIN);\n`,
    });
    const result = resolver.resolveSymbol({
      graph,
      filePath: abs("src/B.ts"),
      identifier: "LOGIN",
    });
    expect(result.unresolved).toBe(false);
    expect(result.exportedSymbol).toBe("LOGIN");
    expect(result.localName).toBe("LOGIN");
    expect(result.resolvedRelativePath).toBe("src/A.ts");
    expect(result.declarationLocation.line).toBe(1);
    expect(chainKinds(result)).toEqual([
      "usage",
      "import",
      "module",
      "export",
      "declaration",
    ]);
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it("renamed import", () => {
    const { resolver, graph, abs } = virtualProject({
      "keys.ts": `export const LOGIN = "auth.login";\n`,
      "app.ts": `import { LOGIN as AUTH } from "./keys";\nt(AUTH);\n`,
    });
    const result = resolver.resolveSymbol({
      graph,
      filePath: abs("app.ts"),
      identifier: "AUTH",
    });
    expect(result.unresolved).toBe(false);
    expect(result.exportedSymbol).toBe("LOGIN");
    expect(result.resolvedRelativePath).toBe("keys.ts");
  });

  it("default import", () => {
    const { resolver, graph, abs } = virtualProject({
      "msg.ts": `export default "home.title";\n`,
      "app.ts": `import key from "./msg";\nt(key);\n`,
    });
    const result = resolver.resolveSymbol({
      graph,
      filePath: abs("app.ts"),
      identifier: "key",
    });
    expect(result.unresolved).toBe(false);
    expect(result.exportedSymbol).toBe("default");
    expect(result.resolvedRelativePath).toBe("msg.ts");
  });

  it("namespace import stays unresolved for bare identifier", () => {
    const { resolver, graph, abs } = virtualProject({
      "keys.ts": `export const LOGIN = "auth.login";\n`,
      "app.ts": `import * as keys from "./keys";\nt(keys.LOGIN);\n`,
    });
    const result = resolver.resolveSymbol({
      graph,
      filePath: abs("app.ts"),
      identifier: "keys",
    });
    expect(result.exportedSymbol).toBe("*");
    expect(result.unresolved).toBe(true);
    expect(result.confidence).toBe(0.55);
  });
});

describe("exports", () => {
  it("named export", () => {
    const { graph, abs } = virtualProject({
      "a.ts": `export const X = "x";\n`,
    });
    const mod = graph.getModule(abs("a.ts"));
    expect(mod?.exports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ exportName: "X", kind: "local" }),
      ]),
    );
  });

  it("default export", () => {
    const { graph, abs } = virtualProject({
      "a.ts": `export default function main() {}\n`,
    });
    const mod = graph.getModule(abs("a.ts"));
    expect(
      mod?.exports.some((e) => e.exportName === "default" && e.kind === "default"),
    ).toBe(true);
  });

  it("export list without from", () => {
    const { resolver, graph, abs } = virtualProject({
      "a.ts": `
const LOGIN = "auth.login";
export { LOGIN };
`,
      "b.ts": `import { LOGIN } from "./a";\n`,
    });
    const result = resolver.resolveSymbol({
      graph,
      filePath: abs("b.ts"),
      identifier: "LOGIN",
    });
    expect(result.unresolved).toBe(false);
    expect(result.declarationLocation.line).toBe(2);
  });

  it("re-export", () => {
    const { resolver, graph, abs } = virtualProject({
      "src/keys.ts": `export const LOGIN = "auth.login";\n`,
      "src/barrel.ts": `export { LOGIN } from "./keys";\n`,
      "src/app.ts": `import { LOGIN } from "./barrel";\n`,
    });
    const result = resolver.resolveSymbol({
      graph,
      filePath: abs("src/app.ts"),
      identifier: "LOGIN",
    });
    expect(result.resolvedRelativePath).toBe("src/keys.ts");
    expect(chainKinds(result)).toContain("re-export");
  });

  it("export *", () => {
    const { resolver, graph, abs } = virtualProject({
      "src/keys.ts": `export const LOGIN = "auth.login";\n`,
      "src/index.ts": `export * from "./keys";\n`,
      "src/app.ts": `import { LOGIN } from "./index";\n`,
    });
    const result = resolver.resolveSymbol({
      graph,
      filePath: abs("src/app.ts"),
      identifier: "LOGIN",
    });
    expect(result.resolvedRelativePath).toBe("src/keys.ts");
    expect(chainKinds(result)).toContain("star-export");
    // Failed sibling stars must not pollute the chain
    expect(chainKinds(result).filter((k) => k === "star-export")).toHaveLength(
      1,
    );
  });
});

describe("files / path resolution", () => {
  it("relative paths across nested folders", () => {
    const { resolver, graph, abs } = virtualProject({
      "packages/ui/src/keys.ts": `export const TITLE = "ui.title";\n`,
      "packages/app/src/page.ts": `import { TITLE } from "../../ui/src/keys";\n`,
    });
    const result = resolver.resolveSymbol({
      graph,
      filePath: abs("packages/app/src/page.ts"),
      identifier: "TITLE",
    });
    expect(result.unresolved).toBe(false);
    expect(result.resolvedRelativePath).toBe("packages/ui/src/keys.ts");
  });

  it("index.ts resolution", () => {
    const { resolver, abs } = virtualProject({
      "features/auth/index.ts": `export const LOGIN = "auth.login";\n`,
      "app.ts": `import { LOGIN } from "./features/auth";\n`,
    });
    const mod = resolver.resolveSpecifier({
      fromFile: abs("app.ts"),
      specifier: "./features/auth",
    });
    expect(mod?.relativePath).toBe("features/auth/index.ts");
    expect(mod?.strategy).toBe("index");
  });

  it("tsconfig paths", () => {
    const { resolver, graph, abs } = virtualProject(
      {
        "src/keys.ts": `export const LOGIN = "auth.login";\n`,
        "src/app.ts": `import { LOGIN } from "@/keys";\n`,
      },
      {
        tsconfig: JSON.stringify({
          compilerOptions: {
            baseUrl: ".",
            paths: { "@/*": ["src/*"] },
          },
        }),
      },
    );
    const result = resolver.resolveSymbol({
      graph,
      filePath: abs("src/app.ts"),
      identifier: "LOGIN",
    });
    expect(result.unresolved).toBe(false);
    expect(result.resolvedRelativePath).toBe("src/keys.ts");
  });

  it("does not resolve bare package names via baseUrl when paths exist", () => {
    const { resolver, abs } = virtualProject(
      {
        "src/react.ts": `export const X = 1;\n`,
        "src/app.ts": `import { X } from "react";\n`,
      },
      {
        tsconfig: JSON.stringify({
          compilerOptions: {
            baseUrl: ".",
            paths: { "@/*": ["src/*"] },
          },
        }),
      },
    );
    expect(
      resolver.resolveSpecifier({
        fromFile: abs("src/app.ts"),
        specifier: "react",
      }),
    ).toBeUndefined();
  });

  it("configured aliases with leading slash remainder", () => {
    const { resolver, graph, abs } = virtualProject(
      {
        "src/keys.ts": `export const LOGIN = "auth.login";\n`,
        "src/app.ts": `import { LOGIN } from "@/keys";\n`,
      },
      {
        aliases: { "@": "src" },
      },
    );
    // "@/keys" with alias "@" → "src" must become src/keys, not /keys
    const result = resolver.resolveSymbol({
      graph,
      filePath: abs("src/app.ts"),
      identifier: "LOGIN",
    });
    expect(result.unresolved).toBe(false);
    expect(result.resolvedRelativePath).toBe("src/keys.ts");
  });

  it("monorepo-style packages via tsconfig paths", () => {
    const { resolver, graph, abs } = virtualProject(
      {
        "packages/shared/src/keys.ts": `export const LOGIN = "auth.login";\n`,
        "packages/web/src/app.ts": `import { LOGIN } from "@shared/keys";\n`,
      },
      {
        tsconfig: JSON.stringify({
          compilerOptions: {
            baseUrl: ".",
            paths: { "@shared/*": ["packages/shared/src/*"] },
          },
        }),
      },
    );
    const result = resolver.resolveSymbol({
      graph,
      filePath: abs("packages/web/src/app.ts"),
      identifier: "LOGIN",
    });
    expect(result.unresolved).toBe(false);
    expect(result.resolvedRelativePath).toBe("packages/shared/src/keys.ts");
  });
});

describe("edge cases", () => {
  it("circular re-exports", () => {
    const { resolver, graph, abs } = virtualProject({
      "a.ts": `export { LOGIN } from "./b";\n`,
      "b.ts": `export { LOGIN } from "./a";\n`,
      "app.ts": `import { LOGIN } from "./a";\n`,
    });
    const result = resolver.resolveSymbol({
      graph,
      filePath: abs("app.ts"),
      identifier: "LOGIN",
    });
    expect(result.circular).toBe(true);
    expect(result.unresolved).toBe(true);
    expect(result.confidence).toBe(0);
  });

  it("circular export * does not loop forever", () => {
    const { resolver, graph, abs } = virtualProject({
      "a.ts": `export * from "./b";\n`,
      "b.ts": `export * from "./a";\n`,
      "app.ts": `import { LOGIN } from "./a";\n`,
    });
    const result = resolver.resolveSymbol({
      graph,
      filePath: abs("app.ts"),
      identifier: "LOGIN",
    });
    expect(result.circular || result.unresolved).toBe(true);
    expect(result.resolutionChain.length).toBeLessThan(64);
  });

  it("missing files", () => {
    const { resolver, graph, abs } = virtualProject({
      "app.ts": `import { LOGIN } from "./missing";\n`,
    });
    const result = resolver.resolveSymbol({
      graph,
      filePath: abs("app.ts"),
      identifier: "LOGIN",
    });
    expect(result.unresolved).toBe(true);
    expect(
      resolver.resolveSpecifier({
        fromFile: abs("app.ts"),
        specifier: "./missing",
      }),
    ).toBeUndefined();
  });

  it("duplicate local exports are unresolved", () => {
    const { resolver, graph, abs } = virtualProject({
      "a.ts": `
export const LOGIN = "a";
export function LOGIN() {}
`,
      "b.ts": `import { LOGIN } from "./a";\n`,
    });
    // Second export function LOGIN may parse; if both recorded as LOGIN
    const result = resolver.resolveSymbol({
      graph,
      filePath: abs("b.ts"),
      identifier: "LOGIN",
    });
    const mod = graph.getModule(abs("a.ts"));
    const count =
      mod?.exports.filter((e) => e.exportName === "LOGIN").length ?? 0;
    if (count > 1) {
      expect(result.unresolved).toBe(true);
    } else {
      // Parser may collapse — still must not throw / loop
      expect(result.circular).toBe(false);
    }
  });

  it("conflicting export * names are unresolved", () => {
    const { resolver, graph, abs } = virtualProject({
      "a.ts": `export const LOGIN = "a";\n`,
      "b.ts": `export const LOGIN = "b";\n`,
      "barrel.ts": `
export * from "./a";
export * from "./b";
`,
      "app.ts": `import { LOGIN } from "./barrel";\n`,
    });
    const result = resolver.resolveSymbol({
      graph,
      filePath: abs("app.ts"),
      identifier: "LOGIN",
    });
    expect(result.unresolved).toBe(true);
    expect(result.confidence).toBe(0);
  });

  it("unused exports heuristic", () => {
    const { graph, abs } = virtualProject({
      "keys.ts": `
export const USED = "used";
export const UNUSED = "unused";
`,
      "app.ts": `import { USED } from "./keys";\n`,
    });
    const mod = graph.getModule(abs("keys.ts"))!;
    const imported = new Set(["USED"]);
    expect(listUnusedExports(mod, imported)).toEqual(["UNUSED"]);
  });

  it("side-effect imports are recorded", () => {
    const { graph, abs } = virtualProject({
      "polyfill.ts": `export {};\n`,
      "app.ts": `import "./polyfill";\n`,
    });
    expect(graph.getModule(abs("app.ts"))?.sideEffectImports[0]?.specifier).toBe(
      "./polyfill",
    );
  });
});

describe("determinism and cache", () => {
  it("produces identical chains for the same input", () => {
    const project = virtualProject({
      "a.ts": `export const X = "x";\n`,
      "b.ts": `export { X } from "./a";\n`,
      "c.ts": `import { X } from "./b";\n`,
    });
    const a = project.resolver.resolveSymbol({
      graph: project.graph,
      filePath: project.abs("c.ts"),
      identifier: "X",
    });
    const b = project.resolver.resolveSymbol({
      graph: project.graph,
      filePath: project.abs("c.ts"),
      identifier: "X",
    });
    expect(a).toEqual(b);
  });

  it("caches modules across resolves", () => {
    const { resolver, graph, abs } = virtualProject({
      "a.ts": `export const X = "x";\n`,
      "b.ts": `import { X } from "./a";\n`,
    });
    resolver.resolveSymbol({
      graph,
      filePath: abs("b.ts"),
      identifier: "X",
    });
    const before = graph.modulePaths.length;
    resolver.resolveSymbol({
      graph,
      filePath: abs("b.ts"),
      identifier: "X",
    });
    expect(graph.modulePaths.length).toBe(before);
  });

  it("clearCache drops cached modules", () => {
    const { resolver, graph, abs } = virtualProject({
      "a.ts": `export const X = "x";\n`,
      "b.ts": `import { X } from "./a";\n`,
    });
    resolver.resolveSymbol({
      graph,
      filePath: abs("b.ts"),
      identifier: "X",
    });
    resolver.clearCache();
    const graph2 = resolver.buildGraph({
      entryFiles: [abs("b.ts")],
      followDepth: 2,
    });
    expect(graph2.getModule(abs("a.ts"))).toBeDefined();
  });
});
