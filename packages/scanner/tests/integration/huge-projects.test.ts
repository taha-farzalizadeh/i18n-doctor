import { describe, expect, it } from "vitest";
import { writeHugeProject } from "../helpers/builders.js";
import {
  hasPath,
  relativePaths,
  scanRoot,
  withFixture,
} from "../helpers/fixture.js";

describe("huge projects", () => {
  it(
    "scans large ignored trees quickly without loading ignored files into candidates",
    async () => {
      await withFixture(
        async (root) => {
          await writeHugeProject(root, {
            sourceFiles: 250,
            ignoredFiles: 6_000,
            nestingDepth: 6,
          });
        },
        async (root) => {
          const started = performance.now();
          const snapshot = await scanRoot(root, {
            packages: ["."],
            fsConcurrency: 64,
          });
          const elapsedMs = performance.now() - started;

          const paths = relativePaths(snapshot);
          expect(paths.some((p) => p.includes("node_modules"))).toBe(false);
          expect(hasPath(snapshot, "src/index.ts")).toBe(true);
          expect(
            paths.some((p) => p.startsWith("src/features/") && p.endsWith(".ts")),
          ).toBe(true);
          expect(paths.some((p) => p.includes("/leaf.ts"))).toBe(true);

          // Candidates should stay near source set size, not ignored volume.
          expect(snapshot.coverage.filesCandidateCount).toBeLessThan(400);
          expect(snapshot.coverage.filesCandidateCount).toBeGreaterThan(200);
          expect(snapshot.coverage.complete).toBe(true);

          // Soft perf budget: prune-at-walk should finish well under a minute on CI/dev machines.
          expect(elapsedMs).toBeLessThan(45_000);

          // Iterator API should not require materializing via array first for existence checks
          let count = 0;
          for (const _entry of snapshot.files()) {
            count += 1;
          }
          expect(count).toBe(snapshot.coverage.filesCandidateCount);
        },
      );
    },
    60_000,
  );
});
