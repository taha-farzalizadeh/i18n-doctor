import { describe, expect, it } from "vitest";
import {
  hasPath,
  relativePaths,
  scanRoot,
  withFixture,
  writeTree,
} from "../helpers/fixture.js";

describe("unicode filenames", () => {
  it("discovers unicode, spaces, and emoji path segments", async () => {
    await withFixture(
      async (root) =>
        writeTree(root, [
          { path: "package.json", content: JSON.stringify({ name: "unicode-app" }) },
          { path: "src/组件/首页.tsx", content: "export const Page = () => null;\n" },
          { path: "src/файлы/утилиты.ts", content: "export const util = 1;\n" },
          { path: "src/emoji/🚀-launch.ts", content: "export const rocket = true;\n" },
          {
            path: "locales/fa-IR/پیام‌ها.json",
            content: JSON.stringify({ hello: "سلام" }),
          },
          {
            path: "src/weird name/with spaces.ts",
            content: "export const spaced = true;\n",
          },
        ]),
      async (root) => {
        const snapshot = await scanRoot(root);
        const paths = relativePaths(snapshot);

        expect(hasPath(snapshot, "src/组件/首页.tsx")).toBe(true);
        expect(hasPath(snapshot, "src/файлы/утилиты.ts")).toBe(true);
        expect(hasPath(snapshot, "src/emoji/🚀-launch.ts")).toBe(true);
        expect(hasPath(snapshot, "locales/fa-IR/پیام‌ها.json")).toBe(true);
        expect(hasPath(snapshot, "src/weird name/with spaces.ts")).toBe(true);

        const page = [...snapshot.files()].find((f) => f.relativePath === "src/组件/首页.tsx");
        expect(page?.language).toBe("typescript");
        expect(page?.extension).toBe("tsx");

        // Internal representation must stay POSIX-relative
        for (const p of paths) {
          expect(p.includes("\\")).toBe(false);
        }
      },
    );
  });
});
