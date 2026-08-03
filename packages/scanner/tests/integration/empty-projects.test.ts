import { describe, expect, it } from "vitest";
import { ScannerOperationError, createScanner } from "../../src/index.js";
import {
  relativePaths,
  scanRoot,
  withFixture,
  writeTree,
} from "../helpers/fixture.js";

describe("empty and invalid projects", () => {
  it("scans an empty directory as a complete zero-candidate project", async () => {
    await withFixture(
      async () => undefined,
      async (root) => {
        const snapshot = await scanRoot(root, {
          ignoreDefaults: true,
          packages: ["."],
        });
        expect(relativePaths(snapshot)).toEqual([]);
        expect(snapshot.coverage.zeroCandidates).toBe(true);
        expect(snapshot.coverage.complete).toBe(true);
        expect(snapshot.coverage.filesCandidateCount).toBe(0);
      },
    );
  });

  it("scans a package with only ignored content as zero candidates", async () => {
    await withFixture(
      async (root) =>
        writeTree(root, [
          {
            path: "package.json",
            content: JSON.stringify({ name: "empty-ish" }),
          },
          { path: "node_modules/pkg/index.js", content: "module.exports=1;\n" },
          { path: "dist/out.js", content: "/* generated */\n" },
          { path: "README.md", content: "# no supported sources\n" },
        ]),
      async (root) => {
        const snapshot = await scanRoot(root);
        // package.json is a supported json candidate
        expect(relativePaths(snapshot)).toEqual(["package.json"]);
        expect(snapshot.coverage.zeroCandidates).toBe(false);
      },
    );
  });

  it("throws a meaningful InvalidRoot error for missing roots", async () => {
    const scanner = createScanner();
    await expect(
      scanner.buildPlan({ root: "/definitely/missing/i18n-scanner-root-xyz" }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ScannerOperationError);
      expect((error as ScannerOperationError).code).toBe("InvalidRoot");
      expect((error as Error).message).toMatch(/does not exist|Unable to resolve/i);
      return true;
    });
  });

  it("throws InvalidRoot when root points at a file", async () => {
    await withFixture(
      async (root) =>
        writeTree(root, [{ path: "not-a-dir.txt", content: "nope\n" }]),
      async (root) => {
        const fileRoot = `${root}/not-a-dir.txt`;
        const scanner = createScanner();
        await expect(scanner.buildPlan({ root: fileRoot })).rejects.toMatchObject({
          code: "InvalidRoot",
        });
      },
    );
  });
});
