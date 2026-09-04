/**
 * @i18n-doctor/language-server
 *
 * IDE-agnostic Language Server that turns i18n-doctor analysis into live LSP
 * diagnostics plus Go to Translation, Hover, and Completion.
 * Analysis and the translation index are delegated to
 * @i18n-doctor/{cli,config,context,coverage,detect,issues,sources,translation-index,usages}.
 */

import {
  createConnection,
  DidChangeConfigurationNotification,
  DidChangeWatchedFilesNotification,
  DidChangeWorkspaceFoldersNotification,
  StreamMessageReader,
  StreamMessageWriter,
  TextDocumentSyncKind,
  type Connection,
  type Diagnostic as LspDiagnostic,
  type DiagnosticRelatedInformation as LspRelatedInformation,
  type DiagnosticTag as LspDiagnosticTag,
  type InitializeParams,
  type InitializeResult,
} from "vscode-languageserver/node";
import { createStderrSink, type LogLevel, type LogSink } from "./logger.js";
import type { Diagnostic, PublishDiagnosticsParams } from "./protocol.js";
import {
  createServerCore,
  type InitializeParamsLike,
  type ServerCore,
} from "./server.js";
import { currentPlatform, type PlatformId } from "./workspace.js";

export { DIAGNOSTIC_CODES, DIAGNOSTIC_SOURCE } from "./protocol.js";
export { SERVER_NAME, SERVER_VERSION } from "./server.js";
export type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticData,
  Position,
  PublishDiagnosticsParams,
  Range,
} from "./protocol.js";
export type { LogLevel, LogSink } from "./logger.js";

/** Typed config helper for IDE-only users — no separate `i18n-doctor` install. */
export { defineConfig } from "@i18n-doctor/config";

/** Files whose changes can affect i18n diagnostics. */
const WATCHED_GLOBS = [
  "**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts,vue,svelte,astro,html,htm}",
  "**/*.{json,yaml,yml}",
  "**/i18n-doctor.config.{ts,js,mjs,cjs,json}",
  "**/package.json",
] as const;

export interface LanguageServerOptions {
  /** Overrides `languageServer.logLevel` from the i18n-doctor config. */
  readonly logLevel?: LogLevel;
  /** Overrides `languageServer.debounce` (ms) from the i18n-doctor config. */
  readonly debounce?: number;
  /** Fallback workspace root when the client sends no folders. */
  readonly cwd?: string;
  /** Pre-built connection. Defaults to a stdio connection. */
  readonly connection?: Connection;
  /** Transport streams for the default connection. Defaults to stdio. */
  readonly input?: NodeJS.ReadableStream;
  readonly output?: NodeJS.WritableStream;
  /** Log destination. Defaults to the LSP log channel, falling back to stderr. */
  readonly logSink?: LogSink;
  /**
   * Install process-level handlers so an unexpected error cannot kill the
   * server. Enabled for the CLI entry point.
   * @default false
   */
  readonly guardProcess?: boolean;
  readonly platform?: PlatformId;
}

export interface LanguageServer {
  /** Starts listening on the transport. */
  listen(): void;
  /** Stops listening and releases resources. */
  dispose(): void;
  readonly connection: Connection;
}

/**
 * Builds a language server without starting it.
 *
 * Use {@link startLanguageServer} unless you need to attach a custom transport
 * before the first message is read.
 */
export function createLanguageServer(
  options: LanguageServerOptions = {},
): LanguageServer {
  const connection =
    options.connection ??
    createConnection(
      new StreamMessageReader(options.input ?? process.stdin),
      new StreamMessageWriter(options.output ?? process.stdout),
    );

  const platform = options.platform ?? currentPlatform();
  const sink = options.logSink ?? createConnectionSink(connection);

  let supportsWatchers = false;
  let supportsConfiguration = false;

  const core: ServerCore = createServerCore({
    publishDiagnostics: (params) => sendDiagnostics(connection, params),
    logSink: sink,
    platform,
    ...(options.logLevel !== undefined ? { logLevel: options.logLevel } : {}),
    ...(options.debounce !== undefined ? { debounce: options.debounce } : {}),
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    onExit: (code) => {
      process.exitCode = code;
    },
    onRegisterWatchers: () => {
      if (supportsWatchers) {
        void connection.client
          .register(DidChangeWatchedFilesNotification.type, {
            watchers: WATCHED_GLOBS.map((globPattern) => ({ globPattern })),
          })
          .catch((error: unknown) => {
            core.logger.exception("file watcher registration failed", error);
          });
      }
      if (supportsConfiguration) {
        void connection.client
          .register(DidChangeConfigurationNotification.type, undefined)
          .catch((error: unknown) => {
            core.logger.exception("configuration registration failed", error);
          });
      }
    },
  });

  connection.onInitialize((params: InitializeParams): InitializeResult => {
    supportsWatchers = Boolean(
      params.capabilities.workspace?.didChangeWatchedFiles
        ?.dynamicRegistration,
    );
    supportsConfiguration = Boolean(
      params.capabilities.workspace?.configuration,
    );

    const result = core.initialize(params as InitializeParamsLike);
    return {
      capabilities: {
        textDocumentSync: {
          openClose: true,
          change: TextDocumentSyncKind.Incremental,
        },
        definitionProvider: true,
        hoverProvider: true,
        completionProvider: {
          triggerCharacters: ['"', "'", ".", ":"],
        },
        workspace: {
          workspaceFolders: { supported: true, changeNotifications: true },
        },
      },
      serverInfo: { ...result.serverInfo },
    };
  });

  connection.onInitialized(() => core.initialized());
  connection.onDidOpenTextDocument((params) => core.didOpen(params));
  connection.onDidChangeTextDocument((params) => core.didChange(params));
  connection.onDidCloseTextDocument((params) => core.didClose(params));
  connection.onDidSaveTextDocument((params) => core.didSave(params));
  connection.onDidChangeConfiguration((params) =>
    core.didChangeConfiguration(params),
  );
  connection.onDidChangeWatchedFiles((params) =>
    core.didChangeWatchedFiles(params),
  );
  connection.onDefinition((params) => core.definition(params));
  connection.onHover((params) => core.hover(params));
  connection.onCompletion(async (params) => {
    const result = await core.completion(params);
    return result.items.map((item) => ({
      label: item.label,
      kind: item.kind as 1 | 21,
      ...(item.detail !== undefined ? { detail: item.detail } : {}),
      ...(item.documentation !== undefined
        ? { documentation: item.documentation }
        : {}),
      ...(item.insertText !== undefined ? { insertText: item.insertText } : {}),
      ...(item.filterText !== undefined ? { filterText: item.filterText } : {}),
    }));
  });
  // Subscribed as a raw notification: `connection.workspace.onDidChange…`
  // throws when the client did not advertise workspace-folder support.
  connection.onNotification(
    DidChangeWorkspaceFoldersNotification.type,
    (params) => core.didChangeWorkspaceFolders({ event: params.event }),
  );
  connection.onShutdown(() => core.shutdown());
  connection.onExit(() => core.exit());

  if (options.guardProcess) {
    installProcessGuards(core);
  }

  return {
    listen() {
      connection.listen();
      core.logger.info("listening on stdio");
    },
    dispose() {
      try {
        connection.dispose();
      } catch {
        // Disposing an already-closed connection is not an error here.
      }
    },
    connection,
  };
}

/** Creates a language server and starts listening (stdio by default). */
export function startLanguageServer(
  options: LanguageServerOptions = {},
): LanguageServer {
  const server = createLanguageServer({ guardProcess: true, ...options });
  server.listen();
  return server;
}

function sendDiagnostics(
  connection: Connection,
  params: PublishDiagnosticsParams,
): void {
  connection.sendDiagnostics({
    uri: params.uri,
    ...(params.version !== undefined ? { version: params.version } : {}),
    diagnostics: params.diagnostics.map(toLspDiagnostic),
  });
}

function toLspDiagnostic(diagnostic: Diagnostic): LspDiagnostic {
  return {
    range: {
      start: { ...diagnostic.range.start },
      end: { ...diagnostic.range.end },
    },
    severity: diagnostic.severity,
    code: diagnostic.code,
    source: diagnostic.source,
    message: diagnostic.message,
    ...(diagnostic.tags
      ? { tags: [...diagnostic.tags] as LspDiagnosticTag[] }
      : {}),
    ...(diagnostic.relatedInformation
      ? {
          relatedInformation: diagnostic.relatedInformation.map(
            (info): LspRelatedInformation => ({
              location: {
                uri: info.location.uri,
                range: {
                  start: { ...info.location.range.start },
                  end: { ...info.location.range.end },
                },
              },
              message: info.message,
            }),
          ),
        }
      : {}),
    ...(diagnostic.data ? { data: diagnostic.data } : {}),
  };
}

/**
 * Routes log output to the LSP log channel, falling back to stderr.
 * stdout is reserved for the JSON-RPC transport and is never written to.
 */
function createConnectionSink(connection: Connection): LogSink {
  const fallback = createStderrSink();
  return {
    write(level, message) {
      try {
        const text = `[i18n-doctor] ${message}`;
        if (level === "error") connection.console.error(text);
        else if (level === "warn") connection.console.warn(text);
        else if (level === "info") connection.console.info(text);
        else connection.console.log(text);
      } catch {
        fallback.write(level, message);
      }
    },
  };
}

function installProcessGuards(core: ServerCore): void {
  const stderr = createStderrSink();
  process.on("uncaughtException", (error) => {
    stderr.write("error", `uncaught exception: ${String(error)}`);
    core.logger.exception("uncaught exception", error);
  });
  process.on("unhandledRejection", (reason) => {
    stderr.write("error", `unhandled rejection: ${String(reason)}`);
    core.logger.exception("unhandled rejection", reason);
  });
}
