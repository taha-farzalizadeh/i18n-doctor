import { describe, expect, it } from "vitest";
import {
  COMPLETION_TSX,
  DYNAMIC_TSX,
  flatProject,
  namespacedProject,
} from "./fixtures.js";
import { fixture, harness } from "./helpers.js";

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

describe("textDocument/completion", () => {
  it("completes partial keys with translated detail", async () => {
    const root = await fixture(flatProject({ "src/Complete.tsx": COMPLETION_TSX }));
    const h = harness(root);
    await h.start();
    await h.open("src/Complete.tsx", COMPLETION_TSX);

    // Cursor after `auth.`
    const position = posOf(COMPLETION_TSX, 't("auth.")');
    const result = await h.core.completion({
      textDocument: { uri: h.uri("src/Complete.tsx") },
      position: {
        line: position.line,
        character: position.character + 't("auth.'.length,
      },
    });

    const labels = result.items.map((i) => i.label);
    expect(labels).toEqual(expect.arrayContaining(["auth.login", "auth.logout"]));
    expect(new Set(labels).size).toBe(labels.length);
    const login = result.items.find((i) => i.label === "auth.login");
    expect(login?.detail).toBeTruthy();
  });

  it("scopes completions to the active namespace", async () => {
    const text = `import { useTranslation } from "react-i18next";

export function Home() {
  const { t } = useTranslation("home");
  return <button>{t("")}</button>;
}
`;
    const root = await fixture(namespacedProject({ "src/Home.tsx": text }));
    const h = harness(root);
    await h.start();
    await h.open("src/Home.tsx", text);

    const position = posOf(text, 't("")');
    const result = await h.core.completion({
      textDocument: { uri: h.uri("src/Home.tsx") },
      position: {
        line: position.line,
        character: position.character + 3,
      },
    });

    expect(result.items.some((i) => i.label === "SAVE")).toBe(true);
    // profile keys should not appear when namespace is home
    expect(
      result.items.every(
        (i) => i.label === "SAVE" || !i.label.toLowerCase().includes("profile"),
      ),
    ).toBe(true);
  });

  it("returns no completions for dynamic keys", async () => {
    const root = await fixture(flatProject({ "src/Dynamic.tsx": DYNAMIC_TSX }));
    const h = harness(root);
    await h.start();
    await h.open("src/Dynamic.tsx", DYNAMIC_TSX);

    const position = posOf(DYNAMIC_TSX, 't("auth."');
    const result = await h.core.completion({
      textDocument: { uri: h.uri("src/Dynamic.tsx") },
      position: {
        line: position.line,
        character: position.character + 3,
      },
    });

    expect(result.items).toEqual([]);
  });

  it("stays responsive on a large catalog", async () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < 800; i++) big[`k.${i}`] = `v${i}`;
    const text = `import { t } from "i18next";\nexport const x = t("k.");\n`;
    const root = await fixture(
      flatProject({
        "locales/en.json": JSON.stringify(big, null, 2),
        "locales/fa.json": JSON.stringify(big, null, 2),
        "src/Big.tsx": text,
      }),
    );
    const h = harness(root);
    await h.start();
    await h.open("src/Big.tsx", text);

    const position = posOf(text, 't("k.")');
    const started = performance.now();
    const result = await h.core.completion({
      textDocument: { uri: h.uri("src/Big.tsx") },
      position: {
        line: position.line,
        character: position.character + 't("k.'.length,
      },
    });
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.length).toBeLessThanOrEqual(200);
  });
});
