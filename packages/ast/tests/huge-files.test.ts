import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createAstEngine, queryApi, traversalApi } from "../src/index.js";

describe("huge files", () => {
  it(
    "parses a multi-megabyte TypeScript file within budget",
    () => {
      const lines: string[] = ["export const root = true;"];
      for (let i = 0; i < 40_000; i += 1) {
        lines.push(`export const n${i} = (x: number) => x + ${i};`);
      }
      const sourceText = lines.join("\n");
      expect(sourceText.length).toBeGreaterThan(1_000_000);

      const engine = createAstEngine({ cache: false });
      const started = performance.now();
      const parsed = engine.parse({
        fileName: "huge.ts",
        sourceText,
        contentHash: "huge-1",
      });
      const elapsed = performance.now() - started;

      expect(parsed.ok).toBe(true);
      expect(parsed.diagnostics).toHaveLength(0);
      expect(
        traversalApi.findAll(parsed.sourceFile, ts.isVariableStatement).length,
      ).toBeGreaterThan(40_000);

      const last = parsed.sourceFile.statements.at(-1)!;
      const loc = queryApi.getLocation(parsed.sourceFile, last);
      expect(loc.startLine).toBeGreaterThan(40_000);

      // Soft budget for CI/dev machines
      expect(elapsed).toBeLessThan(15_000);
    },
    30_000,
  );
});
