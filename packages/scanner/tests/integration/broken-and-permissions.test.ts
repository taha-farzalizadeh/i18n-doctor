import path from "node:path";
import { describe, expect, it } from "vitest";
import { createScanner } from "../../src/index.js";
import {
  ensureDir,
  hasPath,
  isPosix,
  relativePaths,
  restoreChmod,
  scanRoot,
  tryChmodDenied,
  withFixture,
  writeTree,
} from "../helpers/fixture.js";

describe("broken files and permission errors", () => {
  it("skips oversized files for content reads but keeps lite metadata", async () => {
    await withFixture(
      async (root) =>
        writeTree(root, [
          { path: "package.json", content: JSON.stringify({ name: "big" }) },
          { path: "src/small.ts", content: "export {};\n" },
          { path: "src/huge.ts", content: "x".repeat(4096) },
        ]),
      async (root) => {
        const snapshot = await scanRoot(root, { maxFileBytes: 128 });
        expect(hasPath(snapshot, "src/huge.ts")).toBe(true);

        const huge = [...snapshot.files()].find((f) => f.relativePath === "src/huge.ts");
        expect(huge?.contentState).toBe("skipped-too-large");
        expect(snapshot.errors.some((e) => e.class === "TooLarge")).toBe(true);

        const read = await snapshot.content.read(huge!.fileId);
        expect(read.ok).toBe(false);
        if (!read.ok) {
          expect(read.reason).toBe("too-large");
        }

        const small = [...snapshot.files()].find((f) => f.relativePath === "src/small.ts");
        const smallRead = await snapshot.content.read(small!.fileId);
        expect(smallRead.ok).toBe(true);
      },
    );
  });

  it("marks binary-like content as skipped on read", async () => {
    await withFixture(
      async (root) =>
        writeTree(root, [
          { path: "package.json", content: JSON.stringify({ name: "bin" }) },
          { path: "src/ok.ts", content: "export {};\n" },
          { path: "src/blob.json", content: Buffer.from([0, 1, 2, 3, 4, 0, 9]) },
        ]),
      async (root) => {
        const snapshot = await scanRoot(root);
        const blob = [...snapshot.files()].find((f) => f.relativePath === "src/blob.json");
        expect(blob).toBeTruthy();
        const read = await snapshot.content.read(blob!.fileId);
        expect(read.ok).toBe(false);
        if (!read.ok) {
          expect(read.reason).toBe("binary");
        }
      },
    );
  });

  it("handles invalid package.json without failing the whole scan", async () => {
    await withFixture(
      async (root) =>
        writeTree(root, [
          { path: "package.json", content: "{ not-json" },
          { path: "src/index.ts", content: "export {};\n" },
        ]),
      async (root) => {
        const snapshot = await scanRoot(root, { packages: ["."] });
        expect(hasPath(snapshot, "src/index.ts")).toBe(true);
        expect(snapshot.errors.some((e) => e.message.includes("Invalid package.json"))).toBe(
          true,
        );
      },
    );
  });

  it.skipIf(!isPosix())(
    "records permission errors and marks coverage incomplete in strict mode",
    async () => {
      await withFixture(
        async (root) => {
          await writeTree(root, [
            { path: "package.json", content: JSON.stringify({ name: "perms" }) },
            { path: "src/visible.ts", content: "export {};\n" },
            { path: "locked/hidden.ts", content: "export {};\n" },
          ]);
        },
        async (root) => {
          const locked = path.join(root, "locked");
          const denied = await tryChmodDenied(locked);
          if (!denied) {
            return;
          }

          try {
            const snapshot = await scanRoot(root, {
              packages: ["."],
              completeness: "strict",
            });

            expect(hasPath(snapshot, "src/visible.ts")).toBe(true);
            expect(hasPath(snapshot, "locked/hidden.ts")).toBe(false);
            expect(snapshot.errors.some((e) => e.class === "PermissionDenied")).toBe(true);
            expect(snapshot.coverage.complete).toBe(false);
            expect(snapshot.coverage.unreadableRoots.length).toBeGreaterThan(0);
          } finally {
            await restoreChmod(locked);
          }
        },
      );
    },
  );

  it.skipIf(!isPosix())(
    "best-effort completeness still returns partial results on permission errors",
    async () => {
      await withFixture(
        async (root) => {
          await writeTree(root, [
            { path: "package.json", content: JSON.stringify({ name: "best-effort" }) },
            { path: "src/ok.ts", content: "export {};\n" },
          ]);
          await ensureDir(root, "denied");
          await writeTree(root, [{ path: "denied/x.ts", content: "export {};\n" }]);
        },
        async (root) => {
          const denied = path.join(root, "denied");
          const ok = await tryChmodDenied(denied);
          if (!ok) {
            return;
          }
          try {
            const snapshot = await scanRoot(root, {
              packages: ["."],
              completeness: "best-effort",
            });
            expect(relativePaths(snapshot)).toContain("src/ok.ts");
            expect(snapshot.coverage.complete).toBe(true);
          } finally {
            await restoreChmod(denied);
          }
        },
      );
    },
  );

  it("rescan with empty change set returns the same snapshot instance", async () => {
    await withFixture(
      async (root) =>
        writeTree(root, [
          { path: "package.json", content: JSON.stringify({ name: "rescan" }) },
          { path: "src/a.ts", content: "export {};\n" },
        ]),
      async (root) => {
        const scanner = createScanner({ config: { root } });
        const plan = await scanner.buildPlan({ root, packages: ["."] });
        const first = await scanner.scan(plan, { kind: "workspace" });
        const second = await scanner.rescan(first, plan, { changes: [] });
        expect(second).toBe(first);
      },
    );
  });

  it("rescan with changes produces an updated immutable snapshot", async () => {
    await withFixture(
      async (root) =>
        writeTree(root, [
          { path: "package.json", content: JSON.stringify({ name: "rescan2" }) },
          { path: "src/a.ts", content: "export {};\n" },
        ]),
      async (root) => {
        const scanner = createScanner({ config: { root } });
        const plan = await scanner.buildPlan({ root, packages: ["."] });
        const first = await scanner.scan(plan, { kind: "workspace" });

        await writeTree(root, [{ path: "src/b.ts", content: "export const b = 1;\n" }]);
        const second = await scanner.rescan(first, plan, {
          changes: [{ kind: "created", path: "src/b.ts" as never }],
        });

        expect(second).not.toBe(first);
        expect(hasPath(second, "src/b.ts")).toBe(true);
        expect(hasPath(first, "src/b.ts")).toBe(false);
      },
    );
  });
});
