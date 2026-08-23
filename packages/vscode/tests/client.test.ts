import { describe, expect, it, vi } from "vitest";
import type { ExtensionSettings } from "../src/configuration.js";
import {
  ClientController,
  CloseAction,
  createErrorHandler,
  DOCUMENT_SELECTOR,
  ErrorAction,
  type ClientControllerDeps,
  type ManagedClient,
} from "../src/lifecycle.js";
import type { ServerModule } from "../src/server.js";

const SERVER: ServerModule = { module: "/ext/dist/server.js", kind: "bundled" };

function settings(
  overrides: Partial<ExtensionSettings> = {},
): ExtensionSettings {
  return {
    enabled: true,
    serverPath: undefined,
    languageServer: {},
    ...overrides,
  };
}

interface Harness {
  controller: ClientController;
  clients: FakeClient[];
  errors: string[];
  setSettings(next: ExtensionSettings): void;
  deps: ClientControllerDeps;
}

class FakeClient implements ManagedClient {
  started = 0;
  stopped = 0;
  notifications: { method: string; params: unknown }[] = [];
  failStart: Error | undefined;

  start(): Promise<void> {
    if (this.failStart) return Promise.reject(this.failStart);
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

function harness(initial: ExtensionSettings = settings()): Harness {
  let current = initial;
  const clients: FakeClient[] = [];
  const errors: string[] = [];

  const deps: ClientControllerDeps = {
    readSettings: () => current,
    resolveServer: (explicitPath) =>
      explicitPath === "/missing.js"
        ? { error: "server not found at /missing.js" }
        : {
            server:
              explicitPath !== undefined
                ? { module: explicitPath, kind: "explicit" }
                : SERVER,
          },
    createClient: () => {
      const client = new FakeClient();
      clients.push(client);
      return client;
    },
    showError: (message) => errors.push(message),
  };

  return {
    controller: new ClientController(deps),
    clients,
    errors,
    setSettings: (next) => {
      current = next;
    },
    deps,
  };
}

describe("ClientController lifecycle", () => {
  it("starts the client when enabled", async () => {
    const h = harness();
    await h.controller.start();

    expect(h.controller.isRunning()).toBe(true);
    expect(h.clients).toHaveLength(1);
    expect(h.clients[0]!.started).toBe(1);
  });

  it("does not start when disabled", async () => {
    const h = harness(settings({ enabled: false }));
    await h.controller.start();

    expect(h.controller.isRunning()).toBe(false);
    expect(h.clients).toHaveLength(0);
  });

  it("is idempotent: starting twice launches one client", async () => {
    const h = harness();
    await Promise.all([h.controller.start(), h.controller.start()]);
    await h.controller.start();

    expect(h.clients).toHaveLength(1);
  });

  it("shows an error and stays recoverable when the server is missing", async () => {
    const h = harness(settings({ serverPath: "/missing.js" }));
    await h.controller.start();

    expect(h.controller.isRunning()).toBe(false);
    expect(h.errors).toEqual(["server not found at /missing.js"]);

    // Recoverable: fixing the setting and restarting works.
    h.setSettings(settings());
    await h.controller.restart();
    expect(h.controller.isRunning()).toBe(true);
  });

  it("cleans up and reports when startup fails", async () => {
    const h = harness();
    const boom = new Error("spawn failed");
    h.deps.createClient = () => {
      const client = new FakeClient();
      client.failStart = boom;
      h.clients.push(client);
      return client;
    };

    await h.controller.start();

    expect(h.controller.isRunning()).toBe(false);
    expect(h.clients[0]!.stopped).toBe(1);
    expect(h.errors[0]).toContain("failed to start");
    expect(h.errors[0]).toContain("spawn failed");
  });

  it("stops cleanly and can be disposed twice", async () => {
    const h = harness();
    await h.controller.start();
    await h.controller.dispose();
    await h.controller.dispose();

    expect(h.controller.isRunning()).toBe(false);
    expect(h.clients[0]!.stopped).toBe(1);
  });

  it("restart stops the old client and starts a fresh one", async () => {
    const h = harness();
    await h.controller.start();
    await h.controller.restart();

    expect(h.clients).toHaveLength(2);
    expect(h.clients[0]!.stopped).toBe(1);
    expect(h.clients[1]!.started).toBe(1);
    expect(h.controller.isRunning()).toBe(true);
  });
});

describe("ClientController configuration changes", () => {
  it("forwards setting changes to the running server", async () => {
    const h = harness();
    await h.controller.start();

    h.setSettings(settings({ languageServer: { debounce: 400 } }));
    await h.controller.onConfigurationChanged();

    expect(h.clients).toHaveLength(1);
    expect(h.clients[0]!.notifications).toEqual([
      {
        method: "workspace/didChangeConfiguration",
        params: { settings: { languageServer: { debounce: 400 } } },
      },
    ]);
  });

  it("stops when disabled and starts again when re-enabled", async () => {
    const h = harness();
    await h.controller.start();

    h.setSettings(settings({ enabled: false }));
    await h.controller.onConfigurationChanged();
    expect(h.controller.isRunning()).toBe(false);

    h.setSettings(settings());
    await h.controller.onConfigurationChanged();
    expect(h.controller.isRunning()).toBe(true);
    expect(h.clients).toHaveLength(2);
  });

  it("restarts when the server path changes", async () => {
    const h = harness();
    await h.controller.start();

    h.setSettings(settings({ serverPath: "/opt/other-server.js" }));
    await h.controller.onConfigurationChanged();

    expect(h.clients).toHaveLength(2);
    expect(h.clients[0]!.stopped).toBe(1);
    expect(h.controller.isRunning()).toBe(true);
  });

  it("does not spontaneously start on unrelated changes while stopped", async () => {
    const h = harness();
    // Never started (e.g. irrelevant workspace); a debounce tweak arrives.
    h.setSettings(settings({ languageServer: { debounce: 100 } }));
    await h.controller.onConfigurationChanged();

    expect(h.controller.isRunning()).toBe(false);
    expect(h.clients).toHaveLength(0);
  });
});

describe("createErrorHandler", () => {
  it("restarts after isolated crashes", () => {
    const onPermanentFailure = vi.fn();
    const handler = createErrorHandler({ onPermanentFailure, now: () => 0 });

    expect(handler.closed()).toEqual({
      action: CloseAction.Restart,
      handled: true,
    });
    expect(onPermanentFailure).not.toHaveBeenCalled();
  });

  it("gives up with a message after repeated crashes in a short window", () => {
    const onPermanentFailure = vi.fn();
    let time = 0;
    const handler = createErrorHandler({
      onPermanentFailure,
      maxRestarts: 2,
      windowMs: 1000,
      now: () => time,
    });

    expect((handler.closed() as { action: number }).action).toBe(
      CloseAction.Restart,
    );
    time = 100;
    expect((handler.closed() as { action: number }).action).toBe(
      CloseAction.Restart,
    );
    time = 200;
    expect((handler.closed() as { action: number }).action).toBe(
      CloseAction.DoNotRestart,
    );
    expect(onPermanentFailure).toHaveBeenCalledOnce();
    expect(onPermanentFailure.mock.calls[0]![0]).toContain("Restart Language Server");
  });

  it("forgets crashes outside the window", () => {
    const onPermanentFailure = vi.fn();
    let time = 0;
    const handler = createErrorHandler({
      onPermanentFailure,
      maxRestarts: 1,
      windowMs: 1000,
      now: () => time,
    });

    expect((handler.closed() as { action: number }).action).toBe(
      CloseAction.Restart,
    );
    time = 5000; // Old crash aged out; budget refilled.
    expect((handler.closed() as { action: number }).action).toBe(
      CloseAction.Restart,
    );
    expect(onPermanentFailure).not.toHaveBeenCalled();
  });

  it("tolerates a few transport errors before shutting down", () => {
    const handler = createErrorHandler({
      onPermanentFailure: vi.fn(),
    });
    const err = new Error("io");

    expect(handler.error(err, undefined, 1)).toEqual({
      action: ErrorAction.Continue,
      handled: true,
    });
    expect(handler.error(err, undefined, 5)).toEqual({
      action: ErrorAction.Shutdown,
      handled: true,
    });
  });
});

describe("document selector", () => {
  it("covers all supported languages for saved and unsaved documents", () => {
    const languages = new Set(
      DOCUMENT_SELECTOR.map((f) =>
        typeof f === "string" ? f : (f as { language?: string }).language,
      ),
    );
    expect(languages).toEqual(
      new Set([
        "javascript",
        "javascriptreact",
        "typescript",
        "typescriptreact",
        "json",
        "jsonc",
        "yaml",
      ]),
    );

    const schemes = new Set(
      DOCUMENT_SELECTOR.map((f) => (f as { scheme?: string }).scheme),
    );
    expect(schemes).toEqual(new Set(["file", "untitled"]));
  });
});
