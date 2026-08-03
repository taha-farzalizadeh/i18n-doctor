import { describe, expect, it } from "vitest";
import { classifyExtension, classifyRole } from "../../src/application/classify.js";
import { compileGlob, matchesAnyGlob } from "../../src/infrastructure/glob.js";

describe("glob matcher", () => {
  it("matches nested includes and allows directory descent", () => {
    const globs = ["src/**/*.ts", "locales/**/*.json"].map(compileGlob);
    expect(matchesAnyGlob("src", true, globs)).toBe(true);
    expect(matchesAnyGlob("src/features/a.ts", false, globs)).toBe(true);
    expect(matchesAnyGlob("locales/en.json", false, globs)).toBe(true);
    expect(matchesAnyGlob("README.md", false, globs)).toBe(false);
  });

  it("supports broad **/* includes", () => {
    const globs = [compileGlob("**/*")];
    expect(matchesAnyGlob("packages/web/src/App.tsx", false, globs)).toBe(true);
    expect(matchesAnyGlob("packages", true, globs)).toBe(true);
  });
});

describe("classify", () => {
  it("maps supported extensions to language and syntax domain", () => {
    expect(classifyExtension("src/App.tsx")).toMatchObject({
      extension: "tsx",
      language: "typescript",
      syntaxDomain: "script",
    });
    expect(classifyExtension("ui/Widget.vue")).toMatchObject({
      language: "vue",
      syntaxDomain: "mixed",
    });
    expect(classifyExtension("locales/en.json")).toMatchObject({
      language: "json",
      syntaxDomain: "resource",
    });
    expect(classifyExtension("pages/home.astro")).toMatchObject({
      language: "astro",
      syntaxDomain: "mixed",
    });
  });

  it("derives file roles from path heuristics only", () => {
    expect(classifyRole("package.json")).toBe("config");
    expect(classifyRole("vite.config.ts")).toBe("config");
    expect(classifyRole("dist/bundle.js")).toBe("generated");
    expect(classifyRole("src/App.tsx")).toBe("source");
    expect(classifyRole("locales/en.json")).toBe("resource");
  });
});
