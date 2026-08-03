import path from "node:path";
import { describe, expect, it } from "vitest";
import { asAbsoluteOsPath } from "../../src/domain/brands.js";
import {
  createRootIdentity,
  toRelativePosix,
} from "../../src/domain/path-utils.js";
import {
  relativePaths,
  scanRoot,
  withFixture,
  writeTree,
} from "../helpers/fixture.js";

describe("Windows and Linux path handling", () => {
  it("keeps snapshot paths POSIX-relative on the host platform", async () => {
    await withFixture(
      async (root) =>
        writeTree(root, [
          { path: "package.json", content: JSON.stringify({ name: "paths" }) },
          { path: "src/nested/file.ts", content: "export {};\n" },
        ]),
      async (root) => {
        const snapshot = await scanRoot(root, { packages: ["."] });
        for (const rel of relativePaths(snapshot)) {
          expect(rel.includes("\\")).toBe(false);
          expect(path.isAbsolute(rel)).toBe(false);
          expect(rel.startsWith("./")).toBe(false);
        }
        expect(snapshot.root.osPath).toBeTruthy();
        expect(["posix", "windows-drive", "unc"]).toContain(snapshot.root.kind);
      },
    );
  });

  it("models Windows drive and UNC root identities", () => {
    const drive = createRootIdentity(asAbsoluteOsPath("D:\\code\\acme"));
    expect(drive.kind).toBe("windows-drive");
    expect(drive.digest).toBe("win:d:\\code\\acme");

    const unc = createRootIdentity(asAbsoluteOsPath("\\\\fileserver\\apps\\web"));
    expect(unc.kind).toBe("unc");
  });

  it("normalizes host-absolute nested paths to POSIX relatives", () => {
    const root = asAbsoluteOsPath(path.resolve("/srv/apps/web"));
    const file = asAbsoluteOsPath(path.resolve("/srv/apps/web/src/features/Home.tsx"));
    expect(toRelativePosix(root, file, "sensitive")).toBe("src/features/Home.tsx");
  });

  it("lookup works with POSIX relative keys regardless of OS separators in root", async () => {
    await withFixture(
      async (root) =>
        writeTree(root, [
          { path: "package.json", content: JSON.stringify({ name: "lookup" }) },
          { path: "src/App.tsx", content: "export {};\n" },
        ]),
      async (root) => {
        const snapshot = await scanRoot(root, { packages: ["."] });
        expect(snapshot.lookup("src/App.tsx" as never)).toBeTruthy();
        expect(snapshot.lookup("missing.ts" as never)).toBeUndefined();
      },
    );
  });
});
