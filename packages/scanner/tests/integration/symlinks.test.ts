import { describe, expect, it } from "vitest";
import { writeSymlinkFixture } from "../helpers/builders.js";
import {
  hasPath,
  isPosix,
  relativePaths,
  scanRoot,
  withFixture,
} from "../helpers/fixture.js";

describe("symlinks", () => {
  it.skipIf(!isPosix())(
    "follows within-root file symlinks to canonical paths",
    async () => {
      await withFixture(
        async (root) => writeSymlinkFixture(root),
        async (root) => {
          const snapshot = await scanRoot(root, {
            packages: ["."],
            symlink: "within-root",
          });
          const paths = relativePaths(snapshot);

          expect(paths).toEqual(
            expect.arrayContaining([
              "package.json",
              "src/real.ts",
              "src/inside/target.ts",
              "vendor/shared.ts",
            ]),
          );

          expect(snapshot.lookup("src/alias.ts" as never)).toBe("src/real.ts");
          expect(snapshot.lookup("src/from-vendor.ts" as never)).toBe(
            "vendor/shared.ts",
          );
          expect(paths.filter((p) => p === "src/real.ts")).toHaveLength(1);
          expect(paths.filter((p) => p.endsWith("target.ts"))).toHaveLength(1);

          expect(snapshot.coverage.complete).toBe(true);
          expect(snapshot.coverage.symlinkEscapesBlocked).toBeGreaterThanOrEqual(1);
          expect(
            snapshot.errors.some(
              (e) => e.class === "SymlinkEscape" || e.class === "NotFound",
            ),
          ).toBe(true);
          expect(hasPath(snapshot, "src/broken.ts")).toBe(false);
        },
      );
    },
  );

  it.skipIf(!isPosix())("respects symlink=never and skips link targets", async () => {
    await withFixture(
      async (root) => writeSymlinkFixture(root),
      async (root) => {
        const snapshot = await scanRoot(root, {
          packages: ["."],
          symlink: "never",
        });
        expect(hasPath(snapshot, "src/real.ts")).toBe(true);
        expect(hasPath(snapshot, "src/alias.ts")).toBe(false);
        expect(hasPath(snapshot, "src/linked-dir/target.ts")).toBe(false);
        expect(snapshot.lookup("src/alias.ts" as never)).toBeUndefined();
        expect(snapshot.coverage.symlinkEscapesBlocked).toBe(0);
      },
    );
  });
});
