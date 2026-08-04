import { describe, expect, it } from "vitest";
import { compileGlob } from "../src/index.js";

describe("glob matching", () => {
  it("respects path segment boundaries for **", () => {
    const g = compileGlob("**/generated/**", { basenameFallback: true });
    expect(g.test("src/generated/a.ts")).toBe(true);
    expect(g.test("foo/generatedbar")).toBe(false);
    expect(g.test("mygenerated/x")).toBe(false);
  });

  it("does not glue src/** to srcFoo", () => {
    const g = compileGlob("src/**", { basenameFallback: true });
    expect(g.test("src/App.tsx")).toBe(true);
    expect(g.test("src")).toBe(true);
    expect(g.test("srcFoo")).toBe(false);
  });

  it("basename fallback only when enabled", () => {
    const withBase = compileGlob("*.stories.tsx", { basenameFallback: true });
    const noBase = compileGlob("*.stories.tsx", { basenameFallback: false });
    expect(withBase.test("src/Button.stories.tsx")).toBe(true);
    expect(noBase.test("src/Button.stories.tsx")).toBe(false);
    expect(noBase.test("Button.stories.tsx")).toBe(true);
  });

  it("matches key globs without basename fallback", () => {
    const g = compileGlob("debug.*");
    expect(g.test("debug.foo")).toBe(true);
    expect(g.test("x/debug.foo")).toBe(false);
  });
});
