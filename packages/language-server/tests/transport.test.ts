import { PassThrough } from "node:stream";
import path from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";
import {
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  ExitNotification,
  InitializedNotification,
  InitializeRequest,
  PublishDiagnosticsNotification,
  ShutdownRequest,
  type Diagnostic as LspDiagnostic,
  type InitializeResult,
  type PublishDiagnosticsParams,
} from "vscode-languageserver-protocol";
import {
  createLanguageServer,
  DIAGNOSTIC_SOURCE,
  type LogLevel,
} from "../src/index.js";
import { flatProject, LOGIN_TSX, LOGIN_TSX_FIXED } from "./fixtures.js";
import { fixture } from "./helpers.js";
import { pathToUri } from "../src/workspace.js";

interface Client {
  readonly connection: MessageConnection;
  readonly published: PublishDiagnosticsParams[];
  /** Every byte the server wrote to its output stream. */
  bytes(): string;
  waitFor(
    predicate: (params: PublishDiagnosticsParams) => boolean,
    label: string,
  ): Promise<PublishDiagnosticsParams>;
}

/** Wires a real LSP client to the server over in-memory streams. */
function connect(options: { readonly logLevel?: LogLevel } = {}): Client {
  const clientToServer = new PassThrough();
  const serverToClient = new PassThrough();

  const written: Buffer[] = [];
  serverToClient.on("data", (chunk: Buffer) => written.push(chunk));

  const server = createLanguageServer({
    input: clientToServer,
    output: serverToClient,
    logLevel: options.logLevel ?? "silent",
  });
  server.listen();

  const connection = createMessageConnection(
    new StreamMessageReader(serverToClient),
    new StreamMessageWriter(clientToServer),
  );

  const published: PublishDiagnosticsParams[] = [];
  const waiters: {
    predicate: (params: PublishDiagnosticsParams) => boolean;
    resolve: (params: PublishDiagnosticsParams) => void;
  }[] = [];

  connection.onNotification(PublishDiagnosticsNotification.type, (params) => {
    published.push(params);
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(params)) continue;
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(params);
    }
  });
  connection.listen();

  onTestFinished(() => {
    connection.dispose();
    server.dispose();
  });

  return {
    connection,
    published,
    bytes() {
      return Buffer.concat(written).toString("utf8");
    },
    waitFor(predicate, label) {
      const existing = [...published].reverse().find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`timed out waiting for ${label}`));
        }, 8000);
        waiters.push({
          predicate,
          resolve: (params) => {
            clearTimeout(timer);
            resolve(params);
          },
        });
      });
    },
  };
}

const hasCode = (uri: string, code: string) =>
  (params: PublishDiagnosticsParams): boolean =>
    params.uri === uri &&
    params.diagnostics.some((d: LspDiagnostic) => d.code === code);

const isEmpty = (uri: string) =>
  (params: PublishDiagnosticsParams): boolean =>
    params.uri === uri && params.diagnostics.length === 0;

describe("stdio transport", () => {
  it("completes the LSP handshake and reports its capabilities", async () => {
    const root = await fixture(flatProject());
    const client = connect();

    const result: InitializeResult = await client.connection.sendRequest(
      InitializeRequest.type,
      {
        processId: process.pid,
        rootUri: pathToUri(root),
        capabilities: {},
        workspaceFolders: null,
      },
    );

    expect(result.serverInfo?.name).toBe("i18n-doctor-language-server");
    expect(result.capabilities.textDocumentSync).toEqual({
      openClose: true,
      change: 2,
    });
    expect(result.capabilities.workspace?.workspaceFolders?.supported).toBe(
      true,
    );
    // Diagnostics only: nothing else is advertised in this phase.
    expect(result.capabilities.completionProvider).toBeUndefined();
    expect(result.capabilities.hoverProvider).toBeUndefined();
    expect(result.capabilities.codeActionProvider).toBeUndefined();
  });

  it("delivers the acceptance-criteria diagnostic over the wire", async () => {
    const root = await fixture(flatProject());
    const uri = pathToUri(path.join(root, "src", "Login.tsx"));
    const client = connect();

    await client.connection.sendRequest(InitializeRequest.type, {
      processId: process.pid,
      rootUri: pathToUri(root),
      capabilities: {},
      workspaceFolders: null,
    });
    await client.connection.sendNotification(InitializedNotification.type, {});

    await client.connection.sendNotification(
      DidOpenTextDocumentNotification.type,
      {
        textDocument: {
          uri,
          languageId: "typescriptreact",
          version: 1,
          text: LOGIN_TSX,
        },
      },
    );

    const params = await client.waitFor(
      hasCode(uri, "missing-key"),
      "missing-key on Login.tsx",
    );
    const diagnostic = params.diagnostics.find(
      (d: LspDiagnostic) => d.code === "missing-key",
    );

    expect(diagnostic?.source).toBe(DIAGNOSTIC_SOURCE);
    expect(diagnostic?.message).toBe(
      'Translation key "auth.nonexistent" does not exist.',
    );
    expect(diagnostic?.severity).toBe(1);
    expect(diagnostic?.range).toEqual({
      start: { line: 4, character: 44 },
      end: { line: 4, character: 62 },
    });
  });

  it("clears the diagnostic after an incremental edit", async () => {
    const root = await fixture(flatProject());
    const uri = pathToUri(path.join(root, "src", "Login.tsx"));
    const client = connect();

    await client.connection.sendRequest(InitializeRequest.type, {
      processId: process.pid,
      rootUri: pathToUri(root),
      capabilities: {},
      workspaceFolders: null,
    });
    await client.connection.sendNotification(InitializedNotification.type, {});
    await client.connection.sendNotification(
      DidOpenTextDocumentNotification.type,
      {
        textDocument: {
          uri,
          languageId: "typescriptreact",
          version: 1,
          text: LOGIN_TSX,
        },
      },
    );
    await client.waitFor(hasCode(uri, "missing-key"), "initial diagnostic");

    // Replace just the key literal, the way an editor would.
    await client.connection.sendNotification(
      DidChangeTextDocumentNotification.type,
      {
        textDocument: { uri, version: 2 },
        contentChanges: [
          {
            range: {
              start: { line: 4, character: 45 },
              end: { line: 4, character: 61 },
            },
            text: "auth.logout",
          },
        ],
      },
    );

    const cleared = await client.waitFor(isEmpty(uri), "cleared diagnostics");
    expect(cleared.diagnostics).toEqual([]);
  });

  it("returns to on-disk contents when the document closes", async () => {
    const root = await fixture(
      flatProject({ "src/Login.tsx": LOGIN_TSX_FIXED }),
    );
    const uri = pathToUri(path.join(root, "src", "Login.tsx"));
    const client = connect();

    await client.connection.sendRequest(InitializeRequest.type, {
      processId: process.pid,
      rootUri: pathToUri(root),
      capabilities: {},
      workspaceFolders: null,
    });
    await client.connection.sendNotification(InitializedNotification.type, {});
    await client.connection.sendNotification(
      DidOpenTextDocumentNotification.type,
      {
        textDocument: {
          uri,
          languageId: "typescriptreact",
          version: 1,
          text: LOGIN_TSX,
        },
      },
    );
    await client.waitFor(hasCode(uri, "missing-key"), "buffer diagnostic");

    await client.connection.sendNotification(
      DidCloseTextDocumentNotification.type,
      { textDocument: { uri } },
    );

    const cleared = await client.waitFor(isEmpty(uri), "cleared on close");
    expect(cleared.diagnostics).toEqual([]);
  });

  it("shuts down and exits cleanly", async () => {
    const root = await fixture(flatProject());
    const client = connect();

    await client.connection.sendRequest(InitializeRequest.type, {
      processId: process.pid,
      rootUri: pathToUri(root),
      capabilities: {},
      workspaceFolders: null,
    });
    await client.connection.sendNotification(InitializedNotification.type, {});

    await expect(
      client.connection.sendRequest(ShutdownRequest.type, undefined),
    ).resolves.toBeNull();
    await client.connection.sendNotification(ExitNotification.method);
  });

  it("writes nothing but framed protocol messages, even at debug level", async () => {
    const root = await fixture(flatProject());
    const uri = pathToUri(path.join(root, "src", "Login.tsx"));
    const client = connect({ logLevel: "debug" });

    await client.connection.sendRequest(InitializeRequest.type, {
      processId: process.pid,
      rootUri: pathToUri(root),
      capabilities: {},
      workspaceFolders: null,
    });
    await client.connection.sendNotification(InitializedNotification.type, {});
    await client.connection.sendNotification(
      DidOpenTextDocumentNotification.type,
      {
        textDocument: {
          uri,
          languageId: "typescriptreact",
          version: 1,
          text: LOGIN_TSX,
        },
      },
    );
    await client.waitFor(hasCode(uri, "missing-key"), "diagnostics at debug");

    const written = client.bytes();
    // Debug logging happened, and it travelled as window/logMessage rather
    // than as raw text on the transport stream.
    expect(written).toContain("window/logMessage");
    expect(written.startsWith("Content-Length: ")).toBe(true);
    for (const frame of written.split("Content-Length: ").filter(Boolean)) {
      expect(frame).toMatch(/^\d+\r\n\r\n\{/);
    }
  });
});
