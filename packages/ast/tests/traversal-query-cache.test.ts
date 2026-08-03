import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  createAstEngine,
  queryApi,
  traversalApi,
} from "../src/index.js";
import { engineWithCache, parse } from "./helpers.js";

describe("traversal API", () => {
  it("walks with enter/leave and supports skip/stop", () => {
    const parsed = parse(
      "t.ts",
      `function outer() { function inner() { return 1; } }`,
    );
    const kinds: string[] = [];
    traversalApi.walk(parsed.sourceFile, {
      enter(node) {
        if (ts.isFunctionDeclaration(node)) {
          kinds.push(node.name?.getText(parsed.sourceFile) ?? "?");
          if (node.name?.getText(parsed.sourceFile) === "outer") {
            return; // continue into children
          }
        }
        return undefined;
      },
    });
    expect(kinds).toContain("outer");
    expect(kinds).toContain("inner");

    let seen = 0;
    traversalApi.walk(parsed.sourceFile, {
      enter(node) {
        if (ts.isFunctionDeclaration(node)) {
          seen += 1;
          return "stop";
        }
        return undefined;
      },
    });
    expect(seen).toBe(1);
  });

  it("finds ancestors and children", () => {
    const parsed = parse("a.ts", `export function f() { return 1; }`);
    const ret = traversalApi.find(parsed.sourceFile, ts.isReturnStatement)!;
    const ancestors = traversalApi.getAncestors(ret);
    expect(ancestors.some(ts.isFunctionDeclaration)).toBe(true);
    expect(traversalApi.getChildren(parsed.sourceFile).length).toBeGreaterThan(0);
  });
});

describe("query API", () => {
  it("matches kinds and range queries", () => {
    const parsed = parse(
      "q.ts",
      `const a = 1;\nconst b = 2;\nfunction f() { return a + b; }\n`,
    );
    const fns = queryApi.matchKinds(parsed.sourceFile, [
      ts.SyntaxKind.FunctionDeclaration,
    ]);
    expect(fns).toHaveLength(1);

    const first = parsed.sourceFile.statements[0]!;
    const second = parsed.sourceFile.statements[1]!;
    const inRange = queryApi.getNodesInRange(
      parsed.sourceFile,
      first.getStart(parsed.sourceFile),
      second.end,
    );
    expect(inRange.length).toBeGreaterThan(0);
  });

  it("isKind type-narrows", () => {
    const parsed = parse("k.ts", `class C {}`);
    const node = parsed.sourceFile.statements[0]!;
    expect(queryApi.isKind(node, ts.SyntaxKind.ClassDeclaration)).toBe(true);
  });
});

describe("cache / incremental hooks", () => {
  it("returns fromCache on identical contentHash", () => {
    const engine = engineWithCache();
    const input = {
      fileId: "f1",
      fileName: "cached.ts",
      sourceText: "export const x = 1;",
      contentHash: "hash-1",
    };
    const first = engine.parse(input);
    const second = engine.parse(input);
    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(second.sourceFile).toBe(first.sourceFile);
  });

  it("does not reuse AST when content changes without hash", () => {
    const engine = engineWithCache();
    const a = engine.parse({
      fileId: "f2",
      fileName: "n.ts",
      sourceText: "export const a = 1;",
    });
    const b = engine.parse({
      fileId: "f2",
      fileName: "n.ts",
      sourceText: "export const b = 2;",
    });
    expect(a.fromCache).toBe(false);
    expect(b.fromCache).toBe(false);
    expect(queryApi.getText(b.sourceFile, b.sourceFile.statements[0]!)).toContain(
      "b",
    );
  });

  it("invalidate drops cache entries for a file id", () => {
    const engine = engineWithCache();
    const input = {
      fileId: "f3",
      fileName: "i.ts",
      sourceText: "export const i = 1;",
      contentHash: "i-hash",
    };
    engine.parse(input);
    engine.invalidate("f3");
    const again = engine.parse(input);
    expect(again.fromCache).toBe(false);
  });

  it("parseMany reports cache hits", async () => {
    const engine = createAstEngine({ cache: true, concurrency: 2 });
    const input = {
      fileName: "batch.ts",
      sourceText: "export const z = 1;",
      contentHash: "z",
    };
    await engine.parseMany([input]);
    const second = await engine.parseMany([input, input]);
    expect(second.timings.cacheHits).toBe(2);
  });
});
