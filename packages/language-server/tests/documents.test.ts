import path from "node:path";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { flatProject, LOGIN_TSX, LOGIN_TSX_FIXED } from "./fixtures.js";
import { fixture, harness, json } from "./helpers.js";
import {
  createDocumentStore,
  createOverlayFileSystem,
  createOverlayReaders,
} from "../src/documents.js";
import type { AbsoluteOsPath } from "@i18n-doctor/scanner";
import { pathToUri } from "../src/workspace.js";

const abs = (p: string): AbsoluteOsPath => p as AbsoluteOsPath;

describe("document store", () => {
  it("tracks open, change, and close with versions", () => {
    const store = createDocumentStore();
    const uri = pathToUri("/project/src/a.ts");

    const opened = store.open({
      uri,
      languageId: "typescript",
      version: 3,
      text: "const a = 1;",
    });
    expect(opened?.version).toBe(3);
    expect(store.versionOf(uri)).toBe(3);

    const changed = store.change({
      uri,
      version: 4,
      changes: [{ text: "const a = 2;" }],
    });
    expect(changed?.version).toBe(4);
    expect(changed?.text).toBe("const a = 2;");

    const closed = store.close(uri);
    expect(closed?.version).toBe(4);
    expect(store.get(uri)).toBeUndefined();
    expect(store.versionOf(uri)).toBeUndefined();
  });

  it("applies incremental content changes", () => {
    const store = createDocumentStore();
    const uri = pathToUri("/project/src/a.ts");
    store.open({
      uri,
      languageId: "typescript",
      version: 1,
      text: 't("old.key");\n',
    });

    store.change({
      uri,
      version: 2,
      changes: [
        {
          range: {
            start: { line: 0, character: 2 },
            end: { line: 0, character: 11 },
          },
          text: '"new.key"',
        },
      ],
    });

    expect(store.get(uri)?.text).toBe('t("new.key");\n');
  });

  it("ignores out-of-order change notifications", () => {
    const store = createDocumentStore();
    const uri = pathToUri("/project/src/a.ts");
    store.open({ uri, languageId: "typescript", version: 5, text: "current" });

    store.change({ uri, version: 2, changes: [{ text: "stale" }] });

    expect(store.get(uri)?.text).toBe("current");
    expect(store.versionOf(uri)).toBe(5);
  });

  it("ignores changes for documents that were never opened", () => {
    const store = createDocumentStore();
    const result = store.change({
      uri: pathToUri("/project/src/ghost.ts"),
      version: 1,
      changes: [{ text: "x" }],
    });
    expect(result).toBeUndefined();
  });

  it("skips documents without a file path", () => {
    const store = createDocumentStore();
    const opened = store.open({
      uri: "untitled:Untitled-1",
      languageId: "typescript",
      version: 1,
      text: "x",
    });
    expect(opened).toBeUndefined();
    expect(store.all()).toEqual([]);
  });

  it("resolves text by absolute path", () => {
    const store = createDocumentStore();
    const filePath = path.join(path.sep, "project", "src", "a.ts");
    store.open({
      uri: pathToUri(filePath),
      languageId: "typescript",
      version: 1,
      text: "hello",
    });
    expect(store.textOfPath(filePath)).toBe("hello");
    expect(store.textOfPath(path.join(path.sep, "project", "src", "b.ts"))).toBeUndefined();
  });
});

describe("overlay filesystem", () => {
  it("serves unsaved buffer text instead of the file on disk", async () => {
    const root = await fixture({ "src/a.ts": "on disk\n" });
    const filePath = path.join(root, "src", "a.ts");

    const store = createDocumentStore();
    const overlay = createOverlayFileSystem(store);

    const fromDisk = await overlay.readFile(abs(filePath), 1_000_000);
    expect(Buffer.from(fromDisk).toString("utf8")).toBe("on disk\n");

    store.open({
      uri: pathToUri(filePath),
      languageId: "typescript",
      version: 1,
      text: "in memory\n",
    });

    const fromBuffer = await overlay.readFile(abs(filePath), 1_000_000);
    expect(Buffer.from(fromBuffer).toString("utf8")).toBe("in memory\n");
    // The file on disk is untouched.
    expect(await readFile(filePath, "utf8")).toBe("on disk\n");
  });

  it("reports a never-saved buffer through stat, exists, and readDir", async () => {
    const root = await fixture({ "src/existing.ts": "x\n" });
    const newFile = path.join(root, "src", "brand-new.ts");

    const store = createDocumentStore();
    const overlay = createOverlayFileSystem(store);

    expect(await overlay.exists(abs(newFile))).toBe(false);

    store.open({
      uri: pathToUri(newFile),
      languageId: "typescript",
      version: 1,
      text: "const x = 1;\n",
    });

    expect(await overlay.exists(abs(newFile))).toBe(true);
    const stat = await overlay.stat(abs(newFile));
    expect(stat.kind).toBe("file");
    expect(stat.size).toBe("const x = 1;\n".length);

    const entries = await overlay.readDir(abs(path.join(root, "src")));
    expect(entries.map((e) => e.name).sort()).toEqual([
      "brand-new.ts",
      "existing.ts",
    ]);
  });

  it("reflects the buffer size for a modified open document", async () => {
    const root = await fixture({ "src/a.ts": "0123456789\n" });
    const filePath = path.join(root, "src", "a.ts");
    const store = createDocumentStore();
    const overlay = createOverlayFileSystem(store);

    store.open({
      uri: pathToUri(filePath),
      languageId: "typescript",
      version: 1,
      text: "ab",
    });

    expect((await overlay.stat(abs(filePath))).size).toBe(2);
  });

  it("rejects overlay reads that exceed the byte budget", async () => {
    const root = await fixture({ "src/a.ts": "x" });
    const filePath = path.join(root, "src", "a.ts");
    const store = createDocumentStore();
    const overlay = createOverlayFileSystem(store);
    store.open({
      uri: pathToUri(filePath),
      languageId: "typescript",
      version: 1,
      text: "0123456789",
    });

    await expect(overlay.readFile(abs(filePath), 4)).rejects.toThrow(
      /maxFileBytes/,
    );
  });

  it("synchronous readers prefer buffers and tolerate missing files", async () => {
    const root = await fixture({ "src/a.ts": "on disk" });
    const filePath = path.join(root, "src", "a.ts");
    const store = createDocumentStore();
    const readers = createOverlayReaders(store);

    expect(readers.readFile(filePath)).toBe("on disk");
    store.open({
      uri: pathToUri(filePath),
      languageId: "typescript",
      version: 1,
      text: "buffered",
    });
    expect(readers.readFile(filePath)).toBe("buffered");
    expect(readers.fileExists(filePath)).toBe(true);
    expect(readers.readFile(path.join(root, "nope.ts"))).toBeUndefined();
    expect(readers.fileExists(path.join(root, "nope.ts"))).toBe(false);
    expect(readers.readDir(path.join(root, "missing-dir"))).toBeUndefined();
  });
});

describe("in-memory text drives diagnostics", () => {
  it("uses unsaved edits, not the saved file", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();

    await h.open("src/Login.tsx", LOGIN_TSX);
    expect(h.codesFor("src/Login.tsx")).toContain("missing-key");

    // Fix the key in the buffer only — the file on disk still has the bad key.
    await h.change("src/Login.tsx", LOGIN_TSX_FIXED, 2);
    expect(h.diagnosticsFor("src/Login.tsx")).toEqual([]);
    expect(await readFile(path.join(root, "src", "Login.tsx"), "utf8")).toBe(
      LOGIN_TSX,
    );
  });

  it("analyzes an unsaved locale file edit", async () => {
    const root = await fixture(
      flatProject({
        "src/Login.tsx": `import { t } from "i18next";\nexport const L = () => t("auth.login");\n`,
      }),
    );
    const h = harness(root);
    await h.start();

    // auth.logout is unused on disk.
    expect(
      h.diagnosticsFor("locales/en.json").map((d) => d.data?.key),
    ).toContain("auth.logout");

    await h.open("locales/en.json", json({ auth: { login: "Login" } }));
    // Removing the unused key in the buffer clears its diagnostic.
    expect(
      h.diagnosticsFor("locales/en.json").map((d) => d.data?.key),
    ).not.toContain("auth.logout");
  });

  it("reverts to disk contents after the buffer closes", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);
    await h.change("src/Login.tsx", LOGIN_TSX_FIXED, 2);
    expect(h.diagnosticsFor("src/Login.tsx")).toEqual([]);

    await h.close("src/Login.tsx");

    // The on-disk file still references the missing key.
    expect(h.codesFor("src/Login.tsx")).toContain("missing-key");
  });
});
