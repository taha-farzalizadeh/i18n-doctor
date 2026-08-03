import { describe, expect, it } from "vitest";
import { createScanner } from "../../src/index.js";
import { normalAppFiles } from "../helpers/builders.js";
import { hasPath, relativePaths, scanRoot, withFixture, writeTree } from "../helpers/fixture.js";

describe("normal projects", () => {
  it("discovers supported source and resource files in a realistic app", async () => {
    await withFixture(
      async (root) => writeTree(root, normalAppFiles()),
      async (root) => {
        const snapshot = await scanRoot(root);

        expect(snapshot.coverage.complete).toBe(true);
        expect(snapshot.coverage.zeroCandidates).toBe(false);
        expect(snapshot.packages).toHaveLength(1);
        expect(snapshot.packages[0]?.name).toBe("acme-web");

        const paths = relativePaths(snapshot);
        expect(paths).toEqual(
          expect.arrayContaining([
            "package.json",
            "tsconfig.json",
            "src/index.ts",
            "src/App.tsx",
            "src/hooks/useTitle.ts",
            "src/components/Button.jsx",
            "src/utils/format.mjs",
            "src/legacy/old.cjs",
            "locales/en.json",
            "locales/fr.yml",
            "content/docs.mdx",
            "ui/Widget.vue",
            "ui/Chip.svelte",
            "pages/home.astro",
          ]),
        );

        expect(paths).not.toContain("README.md");
        expect(paths).not.toContain("dist/bundle.js");
        expect(paths).not.toContain("node_modules/react/index.js");
        expect(paths).not.toContain(".env");

        const app = [...snapshot.files()].find((f) => f.relativePath === "src/App.tsx");
        expect(app).toMatchObject({
          language: "typescript",
          syntaxDomain: "script",
          role: "source",
          extension: "tsx",
        });

        const locale = [...snapshot.files()].find(
          (f) => f.relativePath === "locales/en.json",
        );
        expect(locale).toMatchObject({
          language: "json",
          syntaxDomain: "resource",
          role: "resource",
        });
      },
    );
  });

  it("exposes content on demand and keeps discovery free of file bytes", async () => {
    await withFixture(
      async (root) => writeTree(root, normalAppFiles()),
      async (root) => {
        const snapshot = await scanRoot(root, { hash: "on-demand" });
        const fileId = snapshot.lookup("src/index.ts" as never);
        expect(fileId).toBeTruthy();

        const before = snapshot.heavy(fileId!);
        expect(before?.contentHash).toBeUndefined();

        const read = await snapshot.content.read(fileId!);
        expect(read.ok).toBe(true);
        if (read.ok) {
          expect(Buffer.from(read.bytes).toString("utf8")).toContain("App");
        }

        const hash = await snapshot.content.hash(fileId!);
        expect(hash?.algorithm).toBe("sha256");
        expect(hash?.digest).toMatch(/^[a-f0-9]{64}$/);
      },
    );
  });

  it("buildPlan digests are stable for identical config", async () => {
    await withFixture(
      async (root) => writeTree(root, normalAppFiles()),
      async (root) => {
        const scanner = createScanner({ config: { root } });
        const planA = await scanner.buildPlan({ root });
        const planB = await scanner.buildPlan({ root });
        expect(planA.planDigest).toBe(planB.planDigest);
        expect(planA.extensions).toContain("tsx");
      },
    );
  });

  it("supports include filters that narrow discovery", async () => {
    await withFixture(
      async (root) => writeTree(root, normalAppFiles()),
      async (root) => {
        const snapshot = await scanRoot(root, {
          include: ["src/**/*", "locales/**/*"],
          extensions: ["ts", "tsx", "json"],
        });
        const paths = relativePaths(snapshot);
        expect(paths.every((p) => p.startsWith("src/") || p.startsWith("locales/"))).toBe(
          true,
        );
        expect(hasPath(snapshot, "src/App.tsx")).toBe(true);
        expect(hasPath(snapshot, "ui/Widget.vue")).toBe(false);
      },
    );
  });
});
