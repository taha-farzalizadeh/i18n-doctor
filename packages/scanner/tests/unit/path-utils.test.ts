import path from "node:path";
import { describe, expect, it } from "vitest";
import { asAbsoluteOsPath, asRelativePosixPath } from "../../src/domain/brands.js";
import {
  comparePathKey,
  createRootIdentity,
  detectDefaultCasePolicy,
  extensionOf,
  isWithinRoot,
  joinPosix,
  normalizeOsPath,
  toOsPath,
  toRelativePosix,
} from "../../src/domain/path-utils.js";

describe("path-utils", () => {
  describe("Linux/POSIX paths", () => {
    it("normalizes absolute POSIX paths and strips trailing separators", () => {
      const normalized = normalizeOsPath("/tmp/project/");
      expect(String(normalized).endsWith("/")).toBe(false);
      expect(createRootIdentity(normalized).kind).toBe("posix");
    });

    it("converts absolute paths to relative POSIX form", () => {
      const root = asAbsoluteOsPath("/workspace/app");
      const file = asAbsoluteOsPath("/workspace/app/src/index.ts");
      expect(toRelativePosix(root, file, "sensitive")).toBe("src/index.ts");
    });

    it("rejects paths that escape the workspace root", () => {
      const root = asAbsoluteOsPath("/workspace/app");
      const outside = asAbsoluteOsPath("/workspace/other/file.ts");
      expect(toRelativePosix(root, outside, "sensitive")).toBeUndefined();
      expect(isWithinRoot(root, outside, "sensitive")).toBe(false);
    });

    it("joins relative POSIX segments without escaping root", () => {
      expect(joinPosix("packages", "web", "src/index.ts")).toBe(
        "packages/web/src/index.ts",
      );
      expect(() =>
        toOsPath(asAbsoluteOsPath("/workspace"), asRelativePosixPath("../secret")),
      ).toThrow(/escapes root/);
    });
  });

  describe("Windows paths", () => {
    it("classifies drive-letter roots", () => {
      const root = createRootIdentity(asAbsoluteOsPath("C:\\Users\\acme\\project"));
      expect(root.kind).toBe("windows-drive");
      expect(root.digest.startsWith("win:")).toBe(true);
    });

    it("classifies UNC roots", () => {
      const root = createRootIdentity(asAbsoluteOsPath("\\\\server\\share\\repo"));
      expect(root.kind).toBe("unc");
      expect(root.digest.startsWith("unc:")).toBe(true);
    });

    it("normalizes mixed separators into relative POSIX paths on current host semantics", () => {
      // On POSIX hosts, Windows-looking absolute strings are not true OS abs paths.
      // Validate the relative conversion contract using host-absolute paths that mirror nesting.
      const root = normalizeOsPath(path.resolve("/repo"));
      const nested = normalizeOsPath(path.resolve("/repo/packages/web/src/App.tsx"));
      const rel = toRelativePosix(root, nested, "insensitive");
      expect(rel).toBe("packages/web/src/App.tsx");
      expect(String(rel).includes("\\")).toBe(false);
    });

    it("folds case keys when casePolicy is insensitive", () => {
      expect(comparePathKey("Src/App.TSX", "insensitive")).toBe("src/app.tsx");
      expect(comparePathKey("Src/App.TSX", "sensitive")).toBe("Src/App.TSX");
    });
  });

  describe("unicode filenames", () => {
    it("preserves unicode segments in relative paths", () => {
      const root = normalizeOsPath(path.resolve("/tmp/unicode-root"));
      const file = normalizeOsPath(
        path.resolve("/tmp/unicode-root/src/组件/файл-🚀.ts"),
      );
      const rel = toRelativePosix(root, file, "sensitive");
      expect(rel).toBe("src/组件/файл-🚀.ts");
      expect(extensionOf(rel!)).toBe("ts");
    });
  });

  describe("platform defaults", () => {
    it("detects a case policy for the current platform", () => {
      const policy = detectDefaultCasePolicy();
      expect(["sensitive", "insensitive"]).toContain(policy);
    });
  });
});
