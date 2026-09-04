import { describe, expect, it } from "vitest";
import {
  ALIAS_TSX,
  DYNAMIC_TSX,
  flatProject,
  LOGIN_TSX,
  namespacedProject,
  santezProject,
} from "./fixtures.js";
import { fixture, harness } from "./helpers.js";

/** Find 0-based position of needle inside text (first match). */
function posOf(text: string, needle: string): { line: number; character: number } {
  const index = text.indexOf(needle);
  expect(index).toBeGreaterThanOrEqual(0);
  const before = text.slice(0, index);
  const lines = before.split(/\n/);
  return {
    line: lines.length - 1,
    character: (lines[lines.length - 1] ?? "").length,
  };
}

describe("textDocument/definition", () => {
  it("navigates a simple key to the preferred locale catalog", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);

    const position = posOf(LOGIN_TSX, "auth.login");
    const locations = await h.core.definition({
      textDocument: { uri: h.uri("src/Login.tsx") },
      position: {
        line: position.line,
        character: position.character + 2,
      },
    });

    expect(locations.length).toBeGreaterThan(0);
    expect(locations[0]!.uri).toContain("locales/en.json");
    expect(locations[0]!.range.start.line).toBeGreaterThanOrEqual(0);
  });

  it("resolves namespaced keys", async () => {
    const root = await fixture(namespacedProject());
    const h = harness(root);
    await h.start();
    const text = namespacedProject()["src/Home.tsx"]!;
    await h.open("src/Home.tsx", text);

    const position = posOf(text, '"SAVE"');
    const locations = await h.core.definition({
      textDocument: { uri: h.uri("src/Home.tsx") },
      position: {
        line: position.line,
        character: position.character + 2,
      },
    });

    expect(locations.some((l) => l.uri.includes("home.json"))).toBe(true);
    expect(locations.every((l) => !l.uri.includes("profile.json"))).toBe(true);
  });

  it("resolves tx aliases", async () => {
    const root = await fixture(flatProject({ "src/Alias.tsx": ALIAS_TSX }));
    const h = harness(root);
    await h.start();
    await h.open("src/Alias.tsx", ALIAS_TSX);

    const position = posOf(ALIAS_TSX, "auth.login");
    const locations = await h.core.definition({
      textDocument: { uri: h.uri("src/Alias.tsx") },
      position: {
        line: position.line,
        character: position.character + 1,
      },
    });

    expect(locations.length).toBeGreaterThan(0);
    expect(locations[0]!.uri).toMatch(/locales\/en\.json$/);
  });

  it("resolves Santez-style addResourceBundle catalogs", async () => {
    const root = await fixture(santezProject());
    const h = harness(root);
    await h.start();
    const text = santezProject()["src/App.tsx"]!;
    await h.open("src/App.tsx", text);

    const position = posOf(text, '"SAVE"');
    const locations = await h.core.definition({
      textDocument: { uri: h.uri("src/App.tsx") },
      position: {
        line: position.line,
        character: position.character + 2,
      },
    });

    expect(locations.length).toBeGreaterThan(0);
    expect(locations[0]!.uri).toContain("home/i18n/en.ts");
  });

  it("returns no definition for missing keys", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);

    const position = posOf(LOGIN_TSX, "auth.nonexistent");
    const locations = await h.core.definition({
      textDocument: { uri: h.uri("src/Login.tsx") },
      position: {
        line: position.line,
        character: position.character + 2,
      },
    });

    expect(locations).toEqual([]);
  });

  it("returns no definition for dynamic keys", async () => {
    const root = await fixture(flatProject({ "src/Dynamic.tsx": DYNAMIC_TSX }));
    const h = harness(root);
    await h.start();
    await h.open("src/Dynamic.tsx", DYNAMIC_TSX);

    const position = posOf(DYNAMIC_TSX, 't("auth."');
    const locations = await h.core.definition({
      textDocument: { uri: h.uri("src/Dynamic.tsx") },
      position: {
        line: position.line,
        character: position.character + 3,
      },
    });

    expect(locations).toEqual([]);
  });
});
