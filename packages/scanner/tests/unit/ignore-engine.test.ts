import { describe, expect, it } from "vitest";
import { asRelativePosixPath } from "../../src/domain/brands.js";
import {
  IgnoreEngine,
  parseGitignoreContent,
} from "../../src/infrastructure/ignore-engine.js";

describe("IgnoreEngine", () => {
  it("parses gitignore content with comments and negation", () => {
    const rules = parseGitignoreContent(`
# comment
dist
!dist/keep.js
*.log
`);
    expect(rules).toEqual([
      { pattern: "dist", source: "gitignore", negated: false },
      { pattern: "dist/keep.js", source: "gitignore", negated: true },
      { pattern: "*.log", source: "gitignore", negated: false },
    ]);
  });

  it("ignores node_modules and dist with last-match-wins negation", () => {
    const engine = new IgnoreEngine([
      { pattern: "**/node_modules", source: "builtin", negated: false },
      { pattern: "**/node_modules/**", source: "builtin", negated: false },
      { pattern: "dist", source: "gitignore", negated: false },
      { pattern: "dist/**", source: "gitignore", negated: false },
      { pattern: "dist/keep.json", source: "config-include", negated: true },
    ]);

    expect(engine.isIgnored(asRelativePosixPath("node_modules"), true)).toBe(true);
    expect(
      engine.isIgnored(asRelativePosixPath("node_modules/react/index.js"), false),
    ).toBe(true);
    expect(engine.isIgnored(asRelativePosixPath("dist/bundle.js"), false)).toBe(true);
    expect(engine.isIgnored(asRelativePosixPath("dist/keep.json"), false)).toBe(false);
    expect(engine.isIgnored(asRelativePosixPath("src/index.ts"), false)).toBe(false);
  });

  it("supports nested rule layers relative to a base directory", () => {
    const engine = new IgnoreEngine([
      { pattern: "*.log", source: "gitignore", negated: false },
    ]);
    engine.pushLayer(
      [{ pattern: "tmp/**", source: "gitignore", negated: false }],
      "packages/web",
    );

    expect(engine.isIgnored(asRelativePosixPath("debug.log"), false)).toBe(true);
    expect(
      engine.isIgnored(asRelativePosixPath("packages/web/tmp/cache.json"), false),
    ).toBe(true);
    expect(
      engine.isIgnored(asRelativePosixPath("packages/api/tmp/cache.json"), false),
    ).toBe(false);

    engine.popLayer();
    expect(
      engine.isIgnored(asRelativePosixPath("packages/web/tmp/cache.json"), false),
    ).toBe(false);
  });

  it("explains matched rules", () => {
    const engine = new IgnoreEngine([
      { pattern: "**/coverage", source: "builtin", negated: false },
      { pattern: "**/coverage/**", source: "builtin", negated: false },
    ]);
    const explanation = engine.explain(asRelativePosixPath("coverage"));
    expect(explanation.ignored).toBe(true);
    expect(explanation.matchedRule?.pattern).toMatch(/coverage/);
  });

  it("treats directory-only patterns as directories", () => {
    const engine = new IgnoreEngine([
      { pattern: "build/", source: "gitignore", negated: false },
    ]);
    expect(engine.isIgnored(asRelativePosixPath("build"), true)).toBe(true);
    expect(engine.isIgnored(asRelativePosixPath("build"), false)).toBe(false);
  });
});
