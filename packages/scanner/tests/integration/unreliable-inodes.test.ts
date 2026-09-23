import { describe, expect, it } from "vitest";
import { createScanner } from "../../src/index.js";
import type { FileSystemPort, FsStat } from "../../src/ports/filesystem.js";
import { NodeFileSystem } from "../../src/infrastructure/node-fs.js";
import {
  hasPath,
  relativePaths,
  withFixture,
  writeTree,
} from "../helpers/fixture.js";

/**
 * Wraps the real FS but forces every file inode to a fixed synthetic value
 * (VM/network mounts, or Windows file indexes rounded past MAX_SAFE_INTEGER).
 */
function withForcedFileInodes(
  base: FileSystemPort,
  inode: string,
): FileSystemPort {
  return {
    resolveRoot: (p) => base.resolveRoot(p),
    realpath: (p) => base.realpath(p),
    readDir: (p) => base.readDir(p),
    readFile: (p, max) => base.readFile(p, max),
    exists: (p) => base.exists(p),
    async stat(path) {
      const st = await base.stat(path);
      if (st.kind !== "file") {
        return st;
      }
      return {
        ...st,
        device: st.device ?? "1",
        inode,
      } satisfies FsStat;
    },
  };
}

describe("unreliable inodes", () => {
  it("keeps distinct files that share synthetic inode 0", async () => {
    await withFixture(
      async (root) =>
        writeTree(root, [
          { path: "package.json", content: JSON.stringify({ name: "ino0" }) },
          {
            path: "src/filter-drawer/FilterDrawer.tsx",
            content: "export const a = 1;\n",
          },
          {
            path: "src/filter-drawer/validation.ts",
            content: "export const b = 2;\n",
          },
          {
            path: "src/etl/FormConnectToDatabase.tsx",
            content: "export const c = 3;\n",
          },
        ]),
      async (root) => {
        const fs = withForcedFileInodes(new NodeFileSystem(), "0");
        const scanner = createScanner({
          fs,
          config: { root, ignoreDefaults: true, useGitIgnore: false },
        });
        const plan = await scanner.buildPlan({
          root,
          ignoreDefaults: true,
          useGitIgnore: false,
        });
        const snapshot = await scanner.scan(plan, { kind: "workspace" });
        const paths = relativePaths(snapshot);

        expect(hasPath(snapshot, "src/filter-drawer/FilterDrawer.tsx")).toBe(
          true,
        );
        expect(hasPath(snapshot, "src/filter-drawer/validation.ts")).toBe(true);
        expect(hasPath(snapshot, "src/etl/FormConnectToDatabase.tsx")).toBe(
          true,
        );
        expect(
          snapshot.conflicts.filter((c) => c.kind === "duplicate-locator"),
        ).toHaveLength(0);
        expect(paths.length).toBeGreaterThanOrEqual(4);
      },
    );
  });

  it("keeps distinct files when inode collides but size/mtime differ", async () => {
    await withFixture(
      async (root) =>
        writeTree(root, [
          { path: "package.json", content: JSON.stringify({ name: "collide" }) },
          { path: "src/a.ts", content: "export const a = 'aaaaaaaa';\n" },
          { path: "src/b.ts", content: "export const b = 1;\n" },
        ]),
      async (root) => {
        // Simulate Windows Number-precision collapse of distinct 64-bit file ids.
        const fs = withForcedFileInodes(new NodeFileSystem(), "12103423998616740");
        const scanner = createScanner({
          fs,
          config: { root, ignoreDefaults: true, useGitIgnore: false },
        });
        const plan = await scanner.buildPlan({
          root,
          ignoreDefaults: true,
          useGitIgnore: false,
        });
        const snapshot = await scanner.scan(plan, { kind: "workspace" });

        expect(hasPath(snapshot, "src/a.ts")).toBe(true);
        expect(hasPath(snapshot, "src/b.ts")).toBe(true);
        expect(
          snapshot.conflicts.filter((c) => c.kind === "duplicate-locator"),
        ).toHaveLength(0);
      },
    );
  });

  it("documents that Number() is unsafe for Windows file ids past MAX_SAFE_INTEGER", () => {
    const a = 12103423998616740n;
    expect(Number.MAX_SAFE_INTEGER).toBeLessThan(Number(a));
    // Distinct 64-bit ids must stay distinct via String(bigint), not Number().
    expect(String(a)).toBe("12103423998616740");
    expect(String(a + 1n)).toBe("12103423998616741");
  });
});
