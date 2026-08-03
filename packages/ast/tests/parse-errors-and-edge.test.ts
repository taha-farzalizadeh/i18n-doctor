import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createAstEngine, queryApi, traversalApi } from "../src/index.js";
import { parse } from "./helpers.js";

describe("syntax errors", () => {
  it("returns diagnostics and best-effort AST without throwing", () => {
    const parsed = parse("src/bad.ts", "export const x = (");
    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics.length).toBeGreaterThan(0);
    expect(parsed.diagnostics.every((d) => d.category === "parse")).toBe(true);
    expect(parsed.sourceFile).toBeTruthy();
    expect(parsed.diagnostics[0]?.line).toBeGreaterThan(0);
  });

  it("keeps batch parsing after a broken file", async () => {
    const engine = createAstEngine({ cache: false, concurrency: 2 });
    const batch = await engine.parseMany([
      { fileName: "ok.ts", sourceText: "export const ok = 1;" },
      { fileName: "bad.ts", sourceText: "const x = {" },
      { fileName: "also.tsx", sourceText: "export const A = () => <i />;" },
    ]);
    expect(batch.files).toHaveLength(3);
    expect(batch.files[0]?.ok).toBe(true);
    expect(batch.files[1]?.ok).toBe(false);
    expect(batch.files[2]?.ok).toBe(true);
    expect(batch.engineErrors).toHaveLength(0);
  });
});

describe("malformed and empty files", () => {
  it("parses empty files as ok", () => {
    const parsed = parse("empty.ts", "");
    expect(parsed.ok).toBe(true);
    expect(parsed.sourceFile.statements).toHaveLength(0);
  });

  it("parses whitespace-only files as ok", () => {
    expect(parse("ws.ts", "\n\n  \t\n").ok).toBe(true);
  });

  it("handles random binary-like garbage as recoverable parse", () => {
    const parsed = parse("junk.ts", "\u0000\u0001{{{{ not code");
    expect(parsed.sourceFile).toBeTruthy();
    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics.length).toBeGreaterThan(0);
  });

  it("rejects non-string sourceText without throwing", () => {
    const engine = createAstEngine({ cache: false });
    const parsed = engine.parse({
      fileName: "x.ts",
      sourceText: null as unknown as string,
    });
    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics.some((d) => d.category === "engine")).toBe(true);
  });
});

describe("unicode", () => {
  it("parses unicode identifiers and string literals", () => {
    const parsed = parse(
      "src/i18n.ts",
      `
      export const پیام = "سلام";
      export const cafe = "café";
      export const rocket = "🚀";
      export function 求和(a: number, b: number) { return a + b; }
      `,
    );
    expect(parsed.ok).toBe(true);
    const fn = traversalApi.find(parsed.sourceFile, ts.isFunctionDeclaration);
    expect(fn?.name?.getText(parsed.sourceFile)).toBe("求和");
    const loc = queryApi.getLocation(parsed.sourceFile, fn!);
    expect(loc.startLine).toBeGreaterThan(0);
  });
});

describe("comments", () => {
  it("collects line, block, and hashbang comments", () => {
    const parsed = parse(
      "src/comments.ts",
      `#!/usr/bin/env node
      // line comment
      /* block
         comment */
      export const x = 1; // trailing
      `,
    );
    expect(parsed.ok).toBe(true);
    const all = queryApi.getAllComments(parsed.sourceFile);
    expect(all.some((c) => c.kind === "hashbang")).toBe(true);
    expect(all.some((c) => c.kind === "line" && c.text.includes("line comment"))).toBe(
      true,
    );
    expect(all.some((c) => c.kind === "block" && c.text.includes("block"))).toBe(
      true,
    );

    const stmt = parsed.sourceFile.statements[0]!;
    const leading = queryApi.getLeadingComments(parsed.sourceFile, stmt);
    expect(leading.length).toBeGreaterThan(0);
  });

  it("preserves parent links for comment-adjacent nodes", () => {
    const parsed = parse("p.ts", "/* docs */ export const n = 1;");
    const decl = traversalApi.find(parsed.sourceFile, ts.isVariableStatement)!;
    expect(decl.parent).toBe(parsed.sourceFile);
  });
});

describe("source positions (source-map relevant)", () => {
  it("exposes stable 1-based line/character positions", () => {
    const parsed = parse(
      "pos.ts",
      `const a = 1;\nconst b = 2;\n`,
    );
    const second = parsed.sourceFile.statements[1]!;
    const loc = queryApi.getLocation(parsed.sourceFile, second);
    expect(loc.startLine).toBe(2);
    expect(loc.startCharacter).toBe(1);

    const at = queryApi.getNodeAtPosition(parsed.sourceFile, second.getStart());
    expect(at).toBeTruthy();
    expect(queryApi.getText(parsed.sourceFile, at!).includes("b")).toBe(true);
  });

  it("does not synthesize source maps (parse-only engine)", () => {
    const parsed = parse("x.ts", "export const x = 1;");
    expect(
      (parsed.sourceFile as ts.SourceFile & { sourceMap?: unknown }).sourceMap,
    ).toBeUndefined();
    // Positions remain usable as mapping inputs for later phases.
    expect(
      queryApi.getLocation(parsed.sourceFile, parsed.sourceFile.statements[0]!)
        .start,
    ).toBeGreaterThanOrEqual(0);
  });
});
