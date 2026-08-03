import { describe, expect, it } from "vitest";
import { createScanner } from "../../src/index.js";
import { npmWorkspaceFiles, pnpmWorkspaceFiles } from "../helpers/builders.js";
import {
  hasPath,
  relativePaths,
  scanRoot,
  withFixture,
  writeTree,
} from "../helpers/fixture.js";

describe("monorepos", () => {
  it("detects npm workspaces and scans package roots", async () => {
    await withFixture(
      async (root) => writeTree(root, npmWorkspaceFiles()),
      async (root) => {
        const scanner = createScanner({ config: { root } });
        const plan = await scanner.buildPlan({ root });
        expect(plan.packageRoots).toEqual(
          expect.arrayContaining(["packages/web", "packages/api"]),
        );
        expect(plan.packageRoots).not.toContain("");

        const snapshot = await scanner.scan(plan, { kind: "workspace" });
        expect(snapshot.packages.map((p) => p.name).sort()).toEqual([
          "@acme/api",
          "@acme/web",
        ]);

        expect(hasPath(snapshot, "packages/web/src/main.ts")).toBe(true);
        expect(hasPath(snapshot, "packages/api/src/server.ts")).toBe(true);
        expect(
          relativePaths(snapshot).some((p) => p.includes("node_modules")),
        ).toBe(false);
      },
    );
  });

  it("detects pnpm-workspace.yaml package globs", async () => {
    await withFixture(
      async (root) => writeTree(root, pnpmWorkspaceFiles()),
      async (root) => {
        const snapshot = await scanRoot(root);
        expect(snapshot.packages.map((p) => p.root).sort()).toEqual([
          "apps/shop",
          "libs/ui",
        ]);
        expect(hasPath(snapshot, "apps/shop/src/index.ts")).toBe(true);
        expect(hasPath(snapshot, "libs/ui/src/Button.tsx")).toBe(true);
      },
    );
  });

  it("supports package-scoped scans", async () => {
    await withFixture(
      async (root) => writeTree(root, npmWorkspaceFiles()),
      async (root) => {
        const scanner = createScanner({ config: { root } });
        const plan = await scanner.buildPlan({ root });
        const snapshot = await scanner.scan(plan, {
          kind: "packages",
          packageIds: ["packages/web" as never],
        });

        expect(snapshot.packages).toHaveLength(1);
        expect(snapshot.packages[0]?.name).toBe("@acme/web");
        expect(hasPath(snapshot, "packages/web/src/App.tsx")).toBe(true);
        expect(hasPath(snapshot, "packages/api/src/server.ts")).toBe(false);
      },
    );
  });

  it("allows explicit packages override to short-circuit detection", async () => {
    await withFixture(
      async (root) => writeTree(root, npmWorkspaceFiles()),
      async (root) => {
        const snapshot = await scanRoot(root, {
          packages: ["packages/api"],
        });
        expect(snapshot.packages).toHaveLength(1);
        expect(snapshot.packages[0]?.root).toBe("packages/api");
        expect(hasPath(snapshot, "packages/api/src/routes.ts")).toBe(true);
        expect(hasPath(snapshot, "packages/web/src/main.ts")).toBe(false);
      },
    );
  });
});
