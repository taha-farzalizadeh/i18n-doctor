import { describe, expect, it } from "vitest";
import { flatProject, LOGIN_TSX, LOGIN_TSX_FIXED } from "./fixtures.js";
import { find, fixture, harness } from "./helpers.js";

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe("debounced analysis", () => {
  it("does not analyze while keystrokes are still arriving", async () => {
    const root = await fixture(flatProject());
    const h = harness(root, { debounce: 250 });
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);
    h.reset();

    // Simulate typing the fixed key one character at a time.
    const target = LOGIN_TSX_FIXED;
    for (let i = 1; i <= 6; i += 1) {
      h.changeNoWait("src/Login.tsx", target, i + 1);
      await wait(20);
    }

    expect(h.publishes()).toEqual([]);

    await h.settle();
    expect(h.diagnosticsFor("src/Login.tsx")).toEqual([]);
  });

  it("collapses a burst into a single publish per file", async () => {
    const root = await fixture(flatProject());
    const h = harness(root, { debounce: 200 });
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);
    h.reset();

    for (let version = 2; version <= 12; version += 1) {
      h.changeNoWait("src/Login.tsx", LOGIN_TSX_FIXED, version);
    }
    await h.settle();

    expect(h.publishCountFor("src/Login.tsx")).toBe(1);
  });

  it("respects a debounce configured through the client", async () => {
    const root = await fixture(flatProject());
    const h = harness(root, {
      debounce: 0,
      initializationOptions: { languageServer: { debounce: 300 } },
    });
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);
    h.reset();

    h.changeNoWait("src/Login.tsx", LOGIN_TSX_FIXED, 2);
    await wait(60);
    expect(h.publishes()).toEqual([]);

    await h.settle();
    expect(h.diagnosticsFor("src/Login.tsx")).toEqual([]);
  });
});

describe("stale result prevention", () => {
  it("publishes only the newest document state after rapid edits", async () => {
    const root = await fixture(flatProject());
    const h = harness(root, { debounce: 30 });
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);

    const withOtherBadKey = LOGIN_TSX.replace(
      "auth.nonexistent",
      "auth.alsoMissing",
    );

    // Three states in flight; only the last one may be reported.
    h.changeNoWait("src/Login.tsx", LOGIN_TSX_FIXED, 2);
    await wait(35);
    h.changeNoWait("src/Login.tsx", withOtherBadKey, 3);
    await wait(35);
    h.changeNoWait("src/Login.tsx", LOGIN_TSX_FIXED, 4);
    await h.settle();

    expect(h.diagnosticsFor("src/Login.tsx")).toEqual([]);
  });

  it("ends on the newest state even when edits interleave with analysis", async () => {
    const root = await fixture(flatProject());
    const h = harness(root, { debounce: 0 });
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);

    for (let version = 2; version <= 8; version += 1) {
      const text = version % 2 === 0 ? LOGIN_TSX_FIXED : LOGIN_TSX;
      h.changeNoWait("src/Login.tsx", text, version);
      await wait(4);
    }
    // Final state (version 8) is the fixed one.
    await h.settle();

    expect(h.diagnosticsFor("src/Login.tsx")).toEqual([]);
  });

  it("tags each publish with the document version it describes", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);
    h.reset();

    await h.change("src/Login.tsx", LOGIN_TSX_FIXED, 7);

    const publish = h
      .publishes()
      .find((p) => p.uri.endsWith("/src/Login.tsx"));
    expect(publish?.diagnostics).toEqual([]);
    expect(publish?.version).toBe(7);
  });

  it("does not resurrect a diagnostic for a closed document", async () => {
    const root = await fixture(flatProject());
    const h = harness(root, { debounce: 20 });
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);

    h.changeNoWait("src/Login.tsx", LOGIN_TSX_FIXED, 2);
    h.core.didClose({ textDocument: { uri: h.uri("src/Login.tsx") } });
    await h.settle();

    // Back to the on-disk contents, which still have the bad key.
    expect(
      find(h.diagnosticsFor("src/Login.tsx"), "missing-key", "auth.nonexistent"),
    ).toBeDefined();
  });
});

describe("bounded work", () => {
  it("caps diagnostics per file", async () => {
    const lines = Array.from(
      { length: 40 },
      (_, i) => `  t("missing.key${i}");`,
    ).join("\n");
    const source = `import { t } from "i18next";\nexport function All() {\n${lines}\n}\n`;
    const root = await fixture(flatProject({ "src/All.ts": source }));

    const h = harness(root, {
      initializationOptions: { languageServer: { maxDiagnosticsPerFile: 5 } },
    });
    await h.start();
    await h.open("src/All.ts", source);

    expect(h.diagnosticsFor("src/All.ts").length).toBe(5);
    // The cap keeps the earliest positions, so the top of the file is covered.
    expect(h.diagnosticsFor("src/All.ts")[0]?.range.start.line).toBe(2);
  });

  it("runs one analysis for many documents opened together", async () => {
    const root = await fixture(flatProject());
    const h = harness(root, { debounce: 50 });
    await h.start();
    h.reset();

    h.core.didOpen({
      textDocument: {
        uri: h.uri("src/Login.tsx"),
        languageId: "typescriptreact",
        version: 1,
        text: LOGIN_TSX,
      },
    });
    h.core.didOpen({
      textDocument: {
        uri: h.uri("locales/en.json"),
        languageId: "json",
        version: 1,
        text: '{ "auth": { "login": "Login" } }',
      },
    });
    await h.settle();

    expect(h.publishCountFor("src/Login.tsx")).toBeLessThanOrEqual(1);
    expect(h.publishCountFor("locales/en.json")).toBeLessThanOrEqual(1);
  });

  it("reuses the translation catalog when only source files change", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);
    h.reset();

    // Using auth.logout clears unused-key on every locale file that defined it.
    await h.change("src/Login.tsx", LOGIN_TSX_FIXED, 2);

    expect(h.diagnosticsFor("src/Login.tsx")).toEqual([]);
    expect(h.codesFor("locales/en.json")).toEqual([]);
    expect(h.codesFor("locales/fa.json")).toEqual([]);
  });
});
