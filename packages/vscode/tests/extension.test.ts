import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __mock, Uri, commands } from "./mocks/vscode.js";

const hoisted = vi.hoisted(() => {
  class FakeClient {
    started = 0;
    stopped = 0;
    notifications: { method: string; params: unknown }[] = [];
    start(): Promise<void> {
      this.started += 1;
      return Promise.resolve();
    }
    stop(): Promise<void> {
      this.stopped += 1;
      return Promise.resolve();
    }
    sendNotification(method: string, params: unknown): Promise<void> {
      this.notifications.push({ method, params });
      return Promise.resolve();
    }
  }
  return {
    FakeClient,
    clients: [] as InstanceType<typeof FakeClient>[],
    createCalls: [] as { server: unknown; settings: unknown }[],
  };
});

// Avoid loading vscode-languageclient (needs a real `vscode` module). The
// lifecycle controller is the real one; only the LanguageClient factory is faked.
vi.mock("../src/client.js", async () => {
  const lifecycle = await import("../src/lifecycle.js");
  return {
    ...lifecycle,
    createLanguageClient: (server: unknown, settings: unknown) => {
      hoisted.createCalls.push({ server, settings });
      const client = new hoisted.FakeClient();
      hoisted.clients.push(client);
      return client;
    },
  };
});

const { activate, deactivate } = await import("../src/extension.js");

/** A real file usable as an "explicit server path" without building. */
const SERVER_STUB = path.resolve(__dirname, "..", "package.json");

interface TestContext {
  extensionPath: string;
  subscriptions: { dispose(): unknown }[];
}

function makeContext(): TestContext {
  return { extensionPath: path.resolve(__dirname, ".."), subscriptions: [] };
}

/** Configures the mock as a workspace with an i18n-doctor config file. */
function relevantWorkspace(root = "/work/app"): void {
  __mock.addWorkspaceFolder(root);
  __mock.state.findFilesResults.push(
    Uri.file(`${root}/i18n-doctor.config.json`),
  );
}

beforeEach(async () => {
  await deactivate();
  __mock.reset();
  hoisted.clients.length = 0;
  hoisted.createCalls.length = 0;
  __mock.setSetting("i18nDoctor.languageServer.path", SERVER_STUB);
});

describe("activation", () => {
  it("activates and starts the client in an i18n workspace", async () => {
    relevantWorkspace();
    await activate(makeContext() as never);

    expect(hoisted.clients).toHaveLength(1);
    expect(hoisted.clients[0]!.started).toBe(1);
  });

  it("forwards explicitly-set settings as initializationOptions", async () => {
    relevantWorkspace();
    __mock.setSetting("i18nDoctor.languageServer.debounce", 100);
    await activate(makeContext() as never);

    expect(hoisted.createCalls[0]!.settings).toMatchObject({
      languageServer: { debounce: 100 },
    });
  });

  it("stays dormant in an unrelated workspace", async () => {
    __mock.addWorkspaceFolder("/work/unrelated");
    __mock.state.files.set(
      "/work/unrelated/package.json",
      JSON.stringify({ dependencies: { express: "^4.0.0" } }),
    );
    await activate(makeContext() as never);

    expect(hoisted.clients).toHaveLength(0);
  });

  it("starts later when an i18n-doctor config file is created", async () => {
    __mock.addWorkspaceFolder("/work/unrelated");
    await activate(makeContext() as never);
    expect(hoisted.clients).toHaveLength(0);

    __mock.state.findFilesResults.push(
      Uri.file("/work/unrelated/i18n-doctor.config.json"),
    );
    __mock.fireConfigFileCreated("/work/unrelated/i18n-doctor.config.json");
    await settle();

    expect(hoisted.clients).toHaveLength(1);
  });

  it("recognizes an i18n dependency in any workspace folder (multi-root)", async () => {
    __mock.addWorkspaceFolder("/work/backend");
    __mock.addWorkspaceFolder("/work/frontend");
    __mock.state.files.set(
      "/work/backend/package.json",
      JSON.stringify({ dependencies: { express: "^4.0.0" } }),
    );
    __mock.state.files.set(
      "/work/frontend/package.json",
      JSON.stringify({ dependencies: { "react-i18next": "^14.0.0" } }),
    );
    await activate(makeContext() as never);

    expect(hoisted.clients).toHaveLength(1);
  });

  it("starts when a relevant folder is added to the workspace", async () => {
    __mock.addWorkspaceFolder("/work/unrelated");
    await activate(makeContext() as never);
    expect(hoisted.clients).toHaveLength(0);

    __mock.addWorkspaceFolder("/work/i18n-app");
    __mock.state.files.set(
      "/work/i18n-app/package.json",
      JSON.stringify({ dependencies: { i18next: "^23.0.0" } }),
    );
    __mock.fireWorkspaceFoldersChange();
    await settle();

    expect(hoisted.clients).toHaveLength(1);
  });

  it("does not start with no workspace open", async () => {
    await activate(makeContext() as never);
    expect(hoisted.clients).toHaveLength(0);
  });

  it("respects i18nDoctor.enabled=false", async () => {
    relevantWorkspace();
    __mock.setSetting("i18nDoctor.enabled", false);
    await activate(makeContext() as never);

    expect(hoisted.clients).toHaveLength(0);
  });

  it("shows an error when the configured server module is missing", async () => {
    relevantWorkspace();
    __mock.setSetting(
      "i18nDoctor.languageServer.path",
      "/nowhere/server.js",
    );
    await activate(makeContext() as never);

    expect(hoisted.clients).toHaveLength(0);
    expect(__mock.state.errorMessages).toHaveLength(1);
    expect(__mock.state.errorMessages[0]).toContain("/nowhere/server.js");
  });
});

describe("running extension", () => {
  it("forwards i18nDoctor configuration changes to the server", async () => {
    relevantWorkspace();
    await activate(makeContext() as never);

    __mock.setSetting("i18nDoctor.languageServer.debounce", 400);
    __mock.fireConfigurationChange("i18nDoctor.languageServer.debounce");
    await settle();

    expect(hoisted.clients[0]!.notifications).toEqual([
      {
        method: "workspace/didChangeConfiguration",
        params: { settings: { languageServer: { debounce: 400 } } },
      },
    ]);
  });

  it("ignores configuration changes outside the i18nDoctor section", async () => {
    relevantWorkspace();
    await activate(makeContext() as never);

    __mock.fireConfigurationChange("editor.fontSize");
    await settle();

    expect(hoisted.clients[0]!.notifications).toHaveLength(0);
  });

  it("stops when disabled and starts again when re-enabled", async () => {
    relevantWorkspace();
    await activate(makeContext() as never);

    __mock.setSetting("i18nDoctor.enabled", false);
    __mock.fireConfigurationChange("i18nDoctor.enabled");
    await settle();
    expect(hoisted.clients[0]!.stopped).toBe(1);

    __mock.setSetting("i18nDoctor.enabled", true);
    __mock.fireConfigurationChange("i18nDoctor.enabled");
    await settle();
    expect(hoisted.clients).toHaveLength(2);
    expect(hoisted.clients[1]!.started).toBe(1);
  });

  it("provides a restart command", async () => {
    relevantWorkspace();
    await activate(makeContext() as never);

    await commands.executeCommand("i18nDoctor.restartServer");
    await settle();

    expect(hoisted.clients).toHaveLength(2);
    expect(hoisted.clients[0]!.stopped).toBe(1);
    expect(hoisted.clients[1]!.started).toBe(1);
  });

  it("deactivate stops the client so no server process is orphaned", async () => {
    relevantWorkspace();
    await activate(makeContext() as never);

    await deactivate();

    expect(hoisted.clients[0]!.stopped).toBe(1);
  });

  it("deactivate is a no-op when nothing started", async () => {
    await expect(Promise.resolve(deactivate())).resolves.toBeUndefined();
  });
});

/** Lets queued controller transitions and event handlers drain. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}
