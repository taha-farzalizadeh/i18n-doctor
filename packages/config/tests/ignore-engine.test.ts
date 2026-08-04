import { describe, expect, it } from "vitest";
import { createIgnoreEngine } from "../src/index.js";

describe("IgnoreEngine", () => {
  const engine = createIgnoreEngine({
    ignoreKeys: ["debug.*", "legacy.*", "exact"],
    ignoreFiles: ["**/generated/**", "*.stories.tsx"],
    ignoreLocales: ["pseudo", "en-XA"],
    ignoreNamespaces: ["test", "storybook"],
    include: ["src/**", "app/**"],
    exclude: ["**/*.test.ts", "**/__fixtures__/**"],
  });

  it("matches ignoreKeys globs", () => {
    expect(engine.isKeyIgnored("debug.foo").ignored).toBe(true);
    expect(engine.isKeyIgnored("legacy.a").ignored).toBe(true);
    expect(engine.isKeyIgnored("exact").ignored).toBe(true);
    expect(engine.isKeyIgnored("nav.home").ignored).toBe(false);
    expect(engine.isKeyIgnored("x/debug.foo").ignored).toBe(false);
  });

  it("matches ignoreFiles and exclude", () => {
    expect(engine.isFileIgnored("src/generated/a.ts").ignored).toBe(true);
    expect(engine.isFileIgnored("Button.stories.tsx").ignored).toBe(true);
    expect(engine.shouldAnalyzeFile("src/foo.test.ts").ignored).toBe(true);
    expect(engine.shouldAnalyzeFile("src/foo.test.ts").kind).toBe("exclude");
  });

  it("applies include allow-list", () => {
    expect(engine.shouldAnalyzeFile("src/App.tsx").ignored).toBe(false);
    expect(engine.shouldAnalyzeFile("lib/util.ts").ignored).toBe(true);
    expect(engine.shouldAnalyzeFile("lib/util.ts").kind).toBe("include");
  });

  it("matches locales and namespaces", () => {
    expect(engine.isLocaleIgnored("pseudo").ignored).toBe(true);
    expect(engine.isLocaleIgnored("en").ignored).toBe(false);
    expect(engine.isNamespaceIgnored("test").ignored).toBe(true);
    expect(engine.isNamespaceIgnored("common").ignored).toBe(false);
  });

  it("returns pattern provenance", () => {
    const m = engine.isKeyIgnored("debug.x");
    expect(m.pattern).toBe("debug.*");
    expect(m.kind).toBe("ignoreKeys");
  });
});
