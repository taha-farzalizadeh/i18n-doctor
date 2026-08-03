import { describe, expect, it } from "vitest";
import {
  buildInterestingPathSet,
  createPathIndex,
  hasSignal,
  indexRelativePath,
  isCanonicalDirMatch,
} from "../src/internal/path-index.js";

describe("path index", () => {
  it("matches monorepo Next app dirs but not components/app", () => {
    expect(isCanonicalDirMatch("src/app", "src/app")).toBe(true);
    expect(isCanonicalDirMatch("packages/web/src/app", "src/app")).toBe(true);
    expect(isCanonicalDirMatch("packages/web/app", "app")).toBe(true);
    expect(isCanonicalDirMatch("src/components/app", "app")).toBe(false);
    expect(isCanonicalDirMatch("src/lib/pages", "pages")).toBe(false);
  });

  it("indexes nested config and router signals", () => {
    const interesting = buildInterestingPathSet();
    const index = createPathIndex();
    indexRelativePath(
      index,
      "packages/web/next.config.ts",
      interesting,
    );
    indexRelativePath(
      index,
      "packages/web/src/app/page.tsx",
      interesting,
    );

    expect(hasSignal(index, "next.config.ts")).toBe(true);
    expect(hasSignal(index, "src/app")).toBe(true);
    expect(hasSignal(index, "app")).toBe(true);
  });
});
