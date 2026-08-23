import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDiagnosticIndex } from "../src/indexer.js";
import type { LocatedDiagnostic } from "../src/diagnostics.js";
import {
  DiagnosticSeverity,
  DIAGNOSTIC_SOURCE,
  type Diagnostic,
} from "../src/protocol.js";

const FILE_A = path.join(path.sep, "project", "src", "a.ts");
const FILE_B = path.join(path.sep, "project", "src", "b.ts");

function diagnostic(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    range: {
      start: { line: 1, character: 4 },
      end: { line: 1, character: 10 },
    },
    severity: DiagnosticSeverity.Error,
    code: "missing-key",
    source: DIAGNOSTIC_SOURCE,
    message: 'Translation key "a.b" does not exist.',
    ...overrides,
  };
}

function at(absolutePath: string, diag: Diagnostic): LocatedDiagnostic {
  return { absolutePath, diagnostic: diag };
}

describe("diagnostic ownership", () => {
  it("publishes findings grouped per document", () => {
    const index = createDiagnosticIndex();
    const publishes = index.publishSet([
      at(FILE_A, diagnostic()),
      at(FILE_B, diagnostic({ code: "unused-key" })),
      at(FILE_A, diagnostic({ range: {
        start: { line: 5, character: 0 },
        end: { line: 5, character: 3 },
      } })),
    ]);

    expect(publishes.length).toBe(2);
    const forA = publishes.find((p) => p.absolutePath === FILE_A);
    expect(forA?.diagnostics.length).toBe(2);
    expect(forA?.uri.startsWith("file://")).toBe(true);
  });

  it("clears a document that no longer has findings", () => {
    const index = createDiagnosticIndex();
    index.publishSet([at(FILE_A, diagnostic()), at(FILE_B, diagnostic())]);

    const publishes = index.publishSet([at(FILE_A, diagnostic())]);

    expect(publishes.length).toBe(1);
    expect(publishes[0]?.absolutePath).toBe(FILE_B);
    expect(publishes[0]?.diagnostics).toEqual([]);
    expect(index.get(FILE_B)).toEqual([]);
    expect(index.ownedPaths()).toEqual([FILE_A]);
  });

  it("skips republishing an unchanged document", () => {
    const index = createDiagnosticIndex();
    index.publishSet([at(FILE_A, diagnostic())]);

    // Same finding, a distinct object: the client must not be notified again.
    expect(index.publishSet([at(FILE_A, diagnostic())])).toEqual([]);
  });

  it("publishes again when a range shifts", () => {
    const index = createDiagnosticIndex();
    index.publishSet([at(FILE_A, diagnostic())]);

    const moved = index.publishSet([
      at(
        FILE_A,
        diagnostic({
          range: {
            start: { line: 9, character: 4 },
            end: { line: 9, character: 10 },
          },
        }),
      ),
    ]);

    expect(moved.length).toBe(1);
    expect(moved[0]?.diagnostics[0]?.range.start.line).toBe(9);
  });

  it("collapses identical duplicates from overlapping analyses", () => {
    const index = createDiagnosticIndex();
    const publishes = index.publishSet([
      at(FILE_A, diagnostic()),
      at(FILE_A, diagnostic()),
      at(FILE_A, diagnostic()),
    ]);

    expect(publishes[0]?.diagnostics.length).toBe(1);
  });

  it("keeps same-range findings with different codes", () => {
    const index = createDiagnosticIndex();
    const publishes = index.publishSet([
      at(FILE_A, diagnostic({ code: "missing-key" })),
      at(FILE_A, diagnostic({ code: "namespace-unresolved" })),
    ]);

    expect(publishes[0]?.diagnostics.map((d) => d.code)).toEqual([
      "missing-key",
      "namespace-unresolved",
    ]);
  });

  it("sorts by position so the editor list is stable", () => {
    const index = createDiagnosticIndex();
    const publishes = index.publishSet([
      at(FILE_A, diagnostic({ range: {
        start: { line: 9, character: 0 },
        end: { line: 9, character: 1 },
      } })),
      at(FILE_A, diagnostic({ range: {
        start: { line: 2, character: 8 },
        end: { line: 2, character: 9 },
      } })),
      at(FILE_A, diagnostic({ range: {
        start: { line: 2, character: 1 },
        end: { line: 2, character: 2 },
      } })),
    ]);

    expect(
      publishes[0]?.diagnostics.map(
        (d) => `${d.range.start.line}:${d.range.start.character}`,
      ),
    ).toEqual(["2:1", "2:8", "9:0"]);
  });

  it("bounds the number of diagnostics per file", () => {
    const index = createDiagnosticIndex();
    const many = Array.from({ length: 50 }, (_, i) =>
      at(FILE_A, diagnostic({ range: {
        start: { line: i, character: 0 },
        end: { line: i, character: 2 },
      } })),
    );

    const publishes = index.publishSet(many, { limitPerFile: 10 });

    expect(publishes[0]?.diagnostics.length).toBe(10);
    // The first ten by position, so the top of the file is always covered.
    expect(publishes[0]?.diagnostics[0]?.range.start.line).toBe(0);
    expect(publishes[0]?.diagnostics[9]?.range.start.line).toBe(9);
  });

  it("releases a single document", () => {
    const index = createDiagnosticIndex();
    index.publishSet([at(FILE_A, diagnostic()), at(FILE_B, diagnostic())]);

    const released = index.release(FILE_A);
    expect(released?.diagnostics).toEqual([]);
    expect(index.ownedPaths()).toEqual([FILE_B]);
    // Releasing again is a no-op rather than a redundant publish.
    expect(index.release(FILE_A)).toBeUndefined();
  });

  it("releases everything it owns", () => {
    const index = createDiagnosticIndex();
    index.publishSet([at(FILE_A, diagnostic()), at(FILE_B, diagnostic())]);

    const released = index.releaseAll();
    expect(released.length).toBe(2);
    expect(released.every((r) => r.diagnostics.length === 0)).toBe(true);
    expect(index.ownedPaths()).toEqual([]);
    expect(index.releaseAll()).toEqual([]);
  });

  it("matches windows paths regardless of case or separator", () => {
    const win = createDiagnosticIndex({ platform: "win32" });
    win.publishSet([at("C:\\Project\\Src\\A.ts", diagnostic())]);

    expect(win.get("c:\\project\\src\\a.ts").length).toBe(1);
    expect(win.get("C:/Project/Src/A.ts").length).toBe(1);
    expect(win.get("C:\\Project\\Src\\.\\A.ts").length).toBe(1);
    expect(win.get("C:\\Project\\Other.ts")).toEqual([]);
  });

  it("emits forward-slash file URIs for windows paths", () => {
    const win = createDiagnosticIndex({ platform: "win32" });
    const publishes = win.publishSet([
      at("C:\\Project\\Src\\A.ts", diagnostic()),
    ]);

    expect(publishes[0]?.uri).toBe("file:///C:/Project/Src/A.ts");
  });
});
