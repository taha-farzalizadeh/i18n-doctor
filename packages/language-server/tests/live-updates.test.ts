import path from "node:path";
import { describe, expect, it } from "vitest";
import { flatProject, LOGIN_TSX, LOGIN_TSX_FIXED } from "./fixtures.js";
import {
  find,
  fixture,
  harness,
  json,
  removeFile,
  underlined,
  writeFiles,
} from "./helpers.js";

describe("acceptance: a missing key round-trip", () => {
  it("appears, disappears when the key is added, and returns when removed", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);

    // 1. The key does not exist anywhere yet.
    const initial = find(
      h.diagnosticsFor("src/Login.tsx"),
      "missing-key",
      "auth.nonexistent",
    );
    expect(initial).toBeDefined();
    expect(initial?.source).toBe("i18n-doctor");
    expect(initial?.message).toBe(
      'Translation key "auth.nonexistent" does not exist.',
    );
    expect(underlined(LOGIN_TSX, initial!)).toBe('"auth.nonexistent"');

    // 2. The developer creates the key in the base locale.
    await writeFiles(root, {
      "locales/en.json": json({
        auth: { login: "Login", logout: "Log out", nonexistent: "Exists now" },
      }),
    });
    await h.watched([{ relativePath: "locales/en.json", type: "changed" }]);

    expect(h.codesFor("src/Login.tsx")).not.toContain("missing-key");

    // 3. The developer deletes it again.
    await writeFiles(root, {
      "locales/en.json": json({ auth: { login: "Login", logout: "Log out" } }),
    });
    await h.watched([{ relativePath: "locales/en.json", type: "changed" }]);

    expect(
      find(
        h.diagnosticsFor("src/Login.tsx"),
        "missing-key",
        "auth.nonexistent",
      ),
    ).toBeDefined();
  });

  it("resolves against the locale the developer is editing in the IDE", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);
    expect(h.codesFor("src/Login.tsx")).toContain("missing-key");

    // The catalog is edited in an editor buffer and never saved.
    await h.open(
      "locales/en.json",
      json({
        auth: { login: "Login", logout: "Log out", nonexistent: "Exists now" },
      }),
    );

    expect(h.codesFor("src/Login.tsx")).not.toContain("missing-key");
  });
});

describe("source file changes", () => {
  it("replaces the old diagnostic with diagnostics for the new text", async () => {
    const root = await fixture(
      flatProject({
        "src/Login.tsx": `import { t } from "i18next";
export const Login = () => t("auth.oldLogin");
`,
      }),
    );
    const h = harness(root);
    await h.start();
    await h.open(
      "src/Login.tsx",
      `import { t } from "i18next";
export const Login = () => t("auth.oldLogin");
`,
    );

    expect(
      find(h.diagnosticsFor("src/Login.tsx"), "missing-key", "auth.oldLogin"),
    ).toBeDefined();

    const fixed = `import { t } from "i18next";
export const Login = () => t("auth.login");
`;
    await h.change("src/Login.tsx", fixed, 2);

    expect(h.diagnosticsFor("src/Login.tsx")).toEqual([]);
    // The previously unused key is now referenced, so its warning is gone too.
    expect(
      h.diagnosticsFor("locales/en.json").map((d) => d.data?.key),
    ).toEqual(["auth.logout"]);
  });

  it("moves the diagnostic when the key moves within the file", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);

    const before = find(
      h.diagnosticsFor("src/Login.tsx"),
      "missing-key",
      "auth.nonexistent",
    );

    const shifted = `// a new leading comment\n// and another\n${LOGIN_TSX}`;
    await h.change("src/Login.tsx", shifted, 2);

    const after = find(
      h.diagnosticsFor("src/Login.tsx"),
      "missing-key",
      "auth.nonexistent",
    );
    expect(after?.range.start.line).toBe(before!.range.start.line + 2);
    expect(underlined(shifted, after!)).toBe('"auth.nonexistent"');
  });

  it("clears every diagnostic when the file no longer uses i18n", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);
    expect(h.diagnosticsFor("src/Login.tsx").length).toBeGreaterThan(0);

    await h.change("src/Login.tsx", "export const Login = () => null;\n", 2);

    expect(h.diagnosticsFor("src/Login.tsx")).toEqual([]);
    // The keys nobody uses anymore are reported on the catalog instead.
    expect(h.codesFor("locales/en.json")).toEqual(["unused-key", "unused-key"]);
  });

  it("reacts to a source file created on disk outside the editor", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();
    expect(h.codesFor("locales/en.json")).toContain("unused-key");

    await writeFiles(root, {
      "src/Extra.tsx": `import { t } from "i18next";\nexport const E = () => t("auth.logout");\n`,
    });
    await h.watched([{ relativePath: "src/Extra.tsx", type: "created" }]);

    expect(h.diagnosticsFor("locales/en.json")).toEqual([]);
  });

  it("reacts to a source file deleted on disk", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();

    await removeFile(root, "src/Login.tsx");
    await h.watched([{ relativePath: "src/Login.tsx", type: "deleted" }]);

    expect(h.codesFor("locales/en.json")).toEqual(["unused-key", "unused-key"]);
    expect(h.diagnosticsFor("src/Login.tsx")).toEqual([]);
  });
});

describe("locale file changes", () => {
  it("clears missing-translation once the other locale catches up", async () => {
    const root = await fixture(
      flatProject({
        "locales/fa.json": json({ auth: { login: "ورود" } }),
        "src/Login.tsx": `import { t } from "i18next";
export const L = () => [t("auth.login"), t("auth.logout")];
`,
      }),
    );
    const h = harness(root);
    await h.start();

    expect(h.codesFor("locales/en.json")).toContain("missing-translation");

    await writeFiles(root, {
      "locales/fa.json": json({ auth: { login: "ورود", logout: "خروج" } }),
    });
    await h.watched([{ relativePath: "locales/fa.json", type: "changed" }]);

    expect(h.diagnosticsFor("locales/en.json")).toEqual([]);
  });

  it("re-reports keys as unused when a new catalog file appears", async () => {
    const root = await fixture(
      flatProject({
        "locales/en.json": json({ auth: { login: "Login" } }),
        "src/Login.tsx": `import { t } from "i18next";\nexport const L = () => t("auth.login");\n`,
      }),
    );
    const h = harness(root);
    await h.start();
    expect(h.diagnosticsFor("locales/en.json")).toEqual([]);

    await writeFiles(root, {
      "locales/en.json": json({ auth: { login: "Login", brandNew: "New" } }),
    });
    await h.watched([{ relativePath: "locales/en.json", type: "changed" }]);

    const unused = find(
      h.diagnosticsFor("locales/en.json"),
      "unused-key",
      "auth.brandNew",
    );
    expect(unused).toBeDefined();
  });

  it("drops diagnostics for a catalog file that was deleted", async () => {
    const root = await fixture(
      flatProject({
        "locales/extra.json": json({ orphan: { key: "Orphan" } }),
      }),
    );
    const h = harness(root);
    await h.start();
    expect(h.diagnosticsFor("locales/extra.json").length).toBeGreaterThan(0);

    await removeFile(root, "locales/extra.json");
    await h.watched([{ relativePath: "locales/extra.json", type: "deleted" }]);

    expect(h.diagnosticsFor("locales/extra.json")).toEqual([]);
  });

  it("handles a JS catalog module changing on disk", async () => {
    const root = await fixture({
      "package.json": json({
        name: "js-catalog",
        version: "1.0.0",
        dependencies: { i18next: "^23.0.0" },
      }),
      "locales/en.js": `export default {\n  auth: {\n    login: "Login",\n  },\n};\n`,
      "src/App.jsx": `import { t } from "i18next";
export const App = () => [t("auth.login"), t("auth.logout")];
`,
    });
    const h = harness(root);
    await h.start();
    expect(h.codesFor("src/App.jsx")).toEqual(["missing-key"]);

    await writeFiles(root, {
      "locales/en.js": `export default {\n  auth: {\n    login: "Login",\n    logout: "Log out",\n  },\n};\n`,
    });
    await h.watched([{ relativePath: "locales/en.js", type: "changed" }]);

    expect(h.diagnosticsFor("src/App.jsx")).toEqual([]);
  });
});

describe("diagnostic ownership", () => {
  it("publishes an empty array to clear a file it previously owned", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);
    h.reset();

    await h.change("src/Login.tsx", LOGIN_TSX_FIXED, 2);

    const cleared = h
      .publishes()
      .filter((p) => p.uri.endsWith("/src/Login.tsx"));
    expect(cleared.length).toBe(1);
    expect(cleared[0]?.diagnostics).toEqual([]);
  });

  it("does not republish files whose diagnostics did not change", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);
    h.reset();

    // A no-op edit: whitespace only.
    await h.change("src/Login.tsx", `${LOGIN_TSX}\n`, 2);

    expect(h.publishes()).toEqual([]);
  });

  it("never publishes a file twice with the same content in one run", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();

    const uris = h.publishes().map((p) => p.uri);
    expect(new Set(uris).size).toBe(uris.length);
  });

  it("clears everything it owns on shutdown", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);
    h.reset();

    await h.core.shutdown();

    const cleared = h.publishes();
    expect(cleared.length).toBeGreaterThan(0);
    expect(cleared.every((p) => p.diagnostics.length === 0)).toBe(true);
    expect(cleared.map((p) => path.basename(new URL(p.uri).pathname)).sort()).toEqual(
      ["Login.tsx", "en.json", "fa.json"],
    );
  });

  it("clears owned files when a workspace folder is removed", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();
    h.reset();

    await h.removeFolder(root);

    expect(h.publishes().length).toBeGreaterThan(0);
    expect(h.publishes().every((p) => p.diagnostics.length === 0)).toBe(true);
    expect(h.snapshot()).toEqual({});
  });
});
