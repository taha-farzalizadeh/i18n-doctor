import path from "node:path";
import { describe, expect, it } from "vitest";
import { flatProject, LOGIN_TSX } from "./fixtures.js";
import { fixture, harness, json } from "./helpers.js";
import { createNullSink } from "../src/logger.js";
import { createServerCore, TextDocumentSyncKind } from "../src/server.js";
import { discoverWorkspace, pathToUri } from "../src/workspace.js";

describe("initialization", () => {
  it("advertises incremental sync plus definition, hover, and completion", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);

    const result = h.core.initialize({
      rootUri: pathToUri(root),
      capabilities: {},
    });

    expect(result.capabilities.textDocumentSync).toEqual({
      openClose: true,
      change: TextDocumentSyncKind.Incremental,
    });
    expect(result.capabilities.definitionProvider).toBe(true);
    expect(result.capabilities.hoverProvider).toBe(true);
    expect(result.capabilities.completionProvider.triggerCharacters).toEqual([
      '"',
      "'",
      ".",
      ":",
    ]);
    expect(result.capabilities.workspace.workspaceFolders.supported).toBe(true);
    expect(result.serverInfo.name).toBe("i18n-doctor-language-server");
    expect(Object.keys(result.capabilities).sort()).toEqual([
      "completionProvider",
      "definitionProvider",
      "hoverProvider",
      "textDocumentSync",
      "workspace",
    ]);
    expect(h.core.state).toBe("initialized");
  });

  it("analyzes after initialized without any document being opened", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();

    // The unused key lives in a locale file nobody opened.
    expect(h.codesFor("locales/en.json")).toContain("unused-key");
  });

  it("invokes watcher registration once on initialized", async () => {
    const root = await fixture(flatProject());
    let registrations = 0;
    const core = createServerCore({
      publishDiagnostics: () => undefined,
      logSink: createNullSink(),
      logLevel: "silent",
      debounce: 0,
      cwd: root,
      onRegisterWatchers: () => {
        registrations += 1;
      },
    });

    core.initialize({ rootUri: pathToUri(root), capabilities: {} });
    expect(registrations).toBe(0);
    core.initialized();
    await core.settle();
    expect(registrations).toBe(1);
  });

  it("keeps running when watcher registration throws", async () => {
    const root = await fixture(flatProject());
    const published: string[] = [];
    const core = createServerCore({
      publishDiagnostics: (params) => published.push(params.uri),
      logSink: createNullSink(),
      logLevel: "silent",
      debounce: 0,
      cwd: root,
      onRegisterWatchers: () => {
        throw new Error("client refused registration");
      },
    });

    core.initialize({ rootUri: pathToUri(root), capabilities: {} });
    expect(() => core.initialized()).not.toThrow();
    await core.settle();
    expect(published.length).toBeGreaterThan(0);
  });

  it("falls back to cwd when the client sends no folders", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    h.core.initialize({ capabilities: {} });
    h.core.initialized();
    await h.core.settle();
    expect(h.codesFor("locales/en.json")).toContain("unused-key");
  });

  it("accepts multiple workspace folders", async () => {
    const root = await fixture({
      "app-a/package.json": json({ name: "a", version: "1.0.0" }),
      "app-a/locales/en.json": json({ a: { used: "A", unusedA: "A" } }),
      "app-a/src/A.tsx": `import { t } from "i18next";\nexport const A = () => t("a.used");\n`,
      "app-b/package.json": json({ name: "b", version: "1.0.0" }),
      "app-b/locales/en.json": json({ b: { used: "B", unusedB: "B" } }),
      "app-b/src/B.tsx": `import { t } from "i18next";\nexport const B = () => t("b.used");\n`,
    });

    const h = harness(root, {
      folders: [path.join(root, "app-a"), path.join(root, "app-b")],
    });
    await h.start();

    expect(
      h.diagnosticsFor("app-a/locales/en.json").map((d) => d.data?.key),
    ).toContain("a.unusedA");
    expect(
      h.diagnosticsFor("app-b/locales/en.json").map((d) => d.data?.key),
    ).toContain("b.unusedB");
  });

  it("shutdown clears every published diagnostic", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);

    expect(h.diagnosticsFor("src/Login.tsx").length).toBeGreaterThan(0);

    await h.core.shutdown();

    expect(h.core.state).toBe("shutdown");
    expect(h.diagnosticsFor("src/Login.tsx")).toEqual([]);
    expect(h.diagnosticsFor("locales/en.json")).toEqual([]);
  });

  it("exit reports 0 after shutdown and 1 without it", async () => {
    const root = await fixture(flatProject());
    const codes: number[] = [];

    const build = () =>
      createServerCore({
        publishDiagnostics: () => undefined,
        logSink: createNullSink(),
        logLevel: "silent",
        debounce: 0,
        cwd: root,
        onExit: (code) => codes.push(code),
      });

    const clean = build();
    clean.initialize({ rootUri: pathToUri(root), capabilities: {} });
    await clean.shutdown();
    clean.exit();

    const abrupt = build();
    abrupt.initialize({ rootUri: pathToUri(root), capabilities: {} });
    abrupt.exit();

    expect(codes).toEqual([0, 1]);
    expect(clean.state).toBe("exited");
    expect(abrupt.state).toBe("exited");
  });

  it("ignores notifications after shutdown instead of throwing", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();
    await h.core.shutdown();

    expect(() => {
      h.core.didOpen({
        textDocument: {
          uri: h.uri("src/Login.tsx"),
          languageId: "typescriptreact",
          version: 1,
          text: LOGIN_TSX,
        },
      });
    }).not.toThrow();
    await h.settle();
    expect(h.diagnosticsFor("src/Login.tsx")).toEqual([]);
  });
});

describe("workspace detection", () => {
  it("walks up to the nearest package.json", async () => {
    const root = await fixture(flatProject());
    const discovered = discoverWorkspace(path.join(root, "src"));
    expect(discovered.root).toBe(root);
    expect(discovered.packageJsonPath).toBe(path.join(root, "package.json"));
  });

  it("locates an i18n-doctor config file", async () => {
    const root = await fixture(
      flatProject({
        "i18n-doctor.config.json": json({ ignoreKeys: ["auth.logout"] }),
      }),
    );
    const discovered = discoverWorkspace(root);
    expect(discovered.configPath).toBe(
      path.join(root, "i18n-doctor.config.json"),
    );
    expect(discovered.scopes[0]?.ignoreKeys).toEqual(["auth.logout"]);
  });

  it("reports one scope per package in a workspace", async () => {
    const root = await fixture({
      "package.json": json({
        name: "mono",
        version: "1.0.0",
        private: true,
        workspaces: ["packages/*"],
      }),
      "packages/web/package.json": json({ name: "web", version: "1.0.0" }),
      "packages/web/locales/en.json": json({ web: { title: "Web" } }),
      "packages/api/package.json": json({ name: "api", version: "1.0.0" }),
      "packages/api/locales/en.json": json({ api: { title: "Api" } }),
    });

    const discovered = discoverWorkspace(root);
    expect(discovered.isMonorepo).toBe(true);
    expect(discovered.scopes.length).toBeGreaterThan(1);
  });

  it("applies config discovered from package.json", async () => {
    const root = await fixture({
      "package.json": json({
        name: "demo",
        version: "1.0.0",
        dependencies: { i18next: "^23.0.0" },
        "i18n-doctor": { ignoreKeys: ["auth.*"] },
      }),
      "locales/en.json": json({ auth: { login: "Login" } }),
      "src/App.tsx": `import { t } from "i18next";\nexport const App = () => t("other.key");\n`,
    });

    const h = harness(root);
    await h.start();
    // auth.* is ignored, so the unused auth.login must not be reported.
    expect(h.diagnosticsFor("locales/en.json")).toEqual([]);
  });
});
