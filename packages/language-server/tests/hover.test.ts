import { describe, expect, it } from "vitest";
import { flatProject, LOGIN_TSX, namespacedProject } from "./fixtures.js";
import { fixture, harness, json } from "./helpers.js";

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

describe("textDocument/hover", () => {
  it("shows key, locales, namespace metadata, and source", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);

    const position = posOf(LOGIN_TSX, "auth.login");
    const hover = await h.core.hover({
      textDocument: { uri: h.uri("src/Login.tsx") },
      position: {
        line: position.line,
        character: position.character + 2,
      },
    });

    expect(hover).not.toBeNull();
    const md = hover!.contents.value;
    expect(md).toContain("`auth.login`");
    expect(md).toContain("English: Login");
    expect(md).toContain("Persian: ورود");
    expect(md).toMatch(/English: `locales\/en\.json:\d+`/);
    expect(md).toMatch(/Persian: `locales\/fa\.json:\d+`/);
  });

  it("warns when the key is missing", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);

    const position = posOf(LOGIN_TSX, "auth.nonexistent");
    const hover = await h.core.hover({
      textDocument: { uri: h.uri("src/Login.tsx") },
      position: {
        line: position.line,
        character: position.character + 2,
      },
    });

    expect(hover?.contents.value).toContain("Missing translation");
  });

  it("shows namespace for namespaced usages", async () => {
    const root = await fixture(namespacedProject());
    const h = harness(root);
    await h.start();
    const text = namespacedProject()["src/Home.tsx"]!;
    await h.open("src/Home.tsx", text);

    const position = posOf(text, '"SAVE"');
    const hover = await h.core.hover({
      textDocument: { uri: h.uri("src/Home.tsx") },
      position: {
        line: position.line,
        character: position.character + 2,
      },
    });

    expect(hover?.contents.value).toContain("Namespace: home");
    expect(hover?.contents.value).toContain("Save");
  });

  it("respects unsaved catalog edits", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);

    const updated = json({
      auth: { login: "Welcome back!", logout: "Logout" },
    });
    await h.open("locales/en.json", updated);
    await h.change("locales/en.json", updated, 2);

    const position = posOf(LOGIN_TSX, "auth.login");
    const hover = await h.core.hover({
      textDocument: { uri: h.uri("src/Login.tsx") },
      position: {
        line: position.line,
        character: position.character + 2,
      },
    });

    expect(hover?.contents.value).toContain("Welcome back!");
  });
});
