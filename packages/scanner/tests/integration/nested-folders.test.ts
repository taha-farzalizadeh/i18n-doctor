import { describe, expect, it } from "vitest";
import {
  hasPath,
  relativePaths,
  scanRoot,
  withFixture,
  writeTree,
} from "../helpers/fixture.js";

describe("nested folders", () => {
  it("discovers deeply nested source files", async () => {
    const deep =
      "src/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/feature/module.ts";

    await withFixture(
      async (root) =>
        writeTree(root, [
          { path: "package.json", content: JSON.stringify({ name: "nested" }) },
          { path: deep, content: "export const deep = true;\n" },
          { path: "src/a/b/sibling.ts", content: "export const sibling = true;\n" },
        ]),
      async (root) => {
        const snapshot = await scanRoot(root);
        expect(hasPath(snapshot, deep)).toBe(true);
        expect(hasPath(snapshot, "src/a/b/sibling.ts")).toBe(true);
        expect(relativePaths(snapshot).length).toBeGreaterThanOrEqual(3);
      },
    );
  });

  it("does not flatten package boundaries for nested packages when forced as one root", async () => {
    await withFixture(
      async (root) =>
        writeTree(root, [
          { path: "package.json", content: JSON.stringify({ name: "root" }) },
          { path: "apps/web/package.json", content: JSON.stringify({ name: "web" }) },
          { path: "apps/web/src/index.ts", content: "export {};\n" },
          { path: "apps/web/src/nested/page.tsx", content: "export {};\n" },
        ]),
      async (root) => {
        const snapshot = await scanRoot(root, { packages: ["."] });
        const paths = relativePaths(snapshot);
        expect(paths).toEqual(
          expect.arrayContaining([
            "package.json",
            "apps/web/package.json",
            "apps/web/src/index.ts",
            "apps/web/src/nested/page.tsx",
          ]),
        );
        // All files attributed to the single forced package root
        expect(new Set([...snapshot.files()].map((f) => String(f.packageId)))).toEqual(
          new Set(["."]),
        );
      },
    );
  });
});
