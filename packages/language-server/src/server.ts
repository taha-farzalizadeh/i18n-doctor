/**
 * Language server core.
 *
 * Transport-independent: it consumes LSP notification payloads and emits
 * `textDocument/publishDiagnostics` payloads through a callback. `index.ts`
 * binds it to a real JSON-RPC connection; tests drive it directly.
 */

import {
  validateUserConfig,
  type LanguageServerConfig,
} from "@i18n-doctor/config";
import type { TextDocumentContentChangeEvent } from "vscode-languageserver-textdocument";
import {
  createDocumentStore,
  createOverlayFileSystem,
  createOverlayReaders,
  type DocumentStore,
} from "./documents.js";
import {
  createDiagnosticIndex,
  type DiagnosticIndex,
  type DocumentDiagnostics,
} from "./indexer.js";
import {
  createLogger,
  createNullSink,
  createStderrSink,
  describeError,
  type LogLevel,
  type LogSink,
  type Logger,
} from "./logger.js";
import { createProject, type Project } from "./project.js";
import type { PublishDiagnosticsParams } from "./protocol.js";
import { createScheduler, type Scheduler, type TimerApi } from "./scheduler.js";
import {
  currentPlatform,
  isWithin,
  normalizePath,
  resolveWorkspaceRoots,
  uriToPath,
  type PlatformId,
  type WorkspaceInitParams,
} from "./workspace.js";

/** LSP `TextDocumentSyncKind`. */
export const TextDocumentSyncKind = {
  None: 0,
  Full: 1,
  Incremental: 2,
} as const;

export interface InitializeParamsLike extends WorkspaceInitParams {
  readonly processId?: number | null;
  readonly capabilities?: {
    readonly workspace?: {
      readonly didChangeWatchedFiles?: {
        readonly dynamicRegistration?: boolean;
      };
      readonly workspaceFolders?: boolean;
      readonly configuration?: boolean;
    };
  };
  readonly initializationOptions?: unknown;
}

export interface InitializeResultLike {
  readonly capabilities: {
    readonly textDocumentSync: {
      readonly openClose: true;
      readonly change: typeof TextDocumentSyncKind.Incremental;
    };
    readonly workspace: {
      readonly workspaceFolders: {
        readonly supported: true;
        readonly changeNotifications: true;
      };
    };
  };
  readonly serverInfo: { readonly name: string; readonly version: string };
}

/** LSP `FileChangeType`. */
export const FileChangeType = {
  Created: 1,
  Changed: 2,
  Deleted: 3,
} as const;

export interface WatchedFileChange {
  readonly uri: string;
  readonly type?: number;
}

export type ServerState = "created" | "initialized" | "shutdown" | "exited";

export interface ServerCoreOptions {
  /** Receives every `textDocument/publishDiagnostics` payload. */
  readonly publishDiagnostics: (params: PublishDiagnosticsParams) => void;
  readonly logLevel?: LogLevel;
  readonly logSink?: LogSink;
  /** Overrides the `languageServer.debounce` config value. */
  readonly debounce?: number;
  readonly cwd?: string;
  readonly platform?: PlatformId;
  readonly timers?: TimerApi;
  /** Called on `exit`, after diagnostics are released. */
  readonly onExit?: (code: number) => void;
  /** Invoked once after `initialized`, for dynamic capability registration. */
  readonly onRegisterWatchers?: () => void;
}

export interface ServerCore {
  initialize(params: InitializeParamsLike): InitializeResultLike;
  initialized(): void;
  didOpen(params: {
    readonly textDocument: {
      readonly uri: string;
      readonly languageId?: string;
      readonly version?: number;
      readonly text: string;
    };
  }): void;
  didChange(params: {
    readonly textDocument: { readonly uri: string; readonly version?: number };
    readonly contentChanges: readonly TextDocumentContentChangeEvent[];
  }): void;
  didClose(params: { readonly textDocument: { readonly uri: string } }): void;
  didSave(params: { readonly textDocument: { readonly uri: string } }): void;
  didChangeConfiguration(params: { readonly settings?: unknown }): void;
  didChangeWatchedFiles(params: {
    readonly changes: readonly WatchedFileChange[];
  }): void;
  didChangeWorkspaceFolders(params: {
    readonly event: {
      readonly added?: readonly { readonly uri: string }[];
      readonly removed?: readonly { readonly uri: string }[];
    };
  }): void;
  shutdown(): Promise<void>;
  exit(): void;
  /** Resolves when all scheduled analysis has settled. */
  settle(): Promise<void>;
  /**
   * Effective language-server settings in use, or undefined before
   * `initialize` resolves a project.
   */
  settings(): Required<LanguageServerConfig> | undefined;
  readonly state: ServerState;
  readonly logger: Logger;
  readonly documents: DocumentStore;
}

export const SERVER_NAME = "i18n-doctor-language-server";
export const SERVER_VERSION = "0.9.1";

export function createServerCore(options: ServerCoreOptions): ServerCore {
  const platform = options.platform ?? currentPlatform();
  const logger = createLogger({
    level: options.logLevel ?? "error",
    sink: options.logSink ?? createStderrSink(),
    scope: "ls",
  });

  const documents = createDocumentStore({ platform });
  const index: DiagnosticIndex = createDiagnosticIndex({ platform });
  const overlayFs = createOverlayFileSystem(documents, { platform });
  const readers = createOverlayReaders(documents);

  let state: ServerState = "created";
  let projects: Project[] = [];
  let overrides: LanguageServerConfig = {
    ...(options.debounce !== undefined ? { debounce: options.debounce } : {}),
    ...(options.logLevel !== undefined ? { logLevel: options.logLevel } : {}),
  };

  const scheduler: Scheduler = createScheduler({
    debounceMs: options.debounce ?? 250,
    logger,
    ...(options.timers ? { timers: options.timers } : {}),
    run: (context) => runAnalysis(context.signal, context.isStale),
    onError: (error) => {
      // Analysis failures are reported but never fatal: the previously
      // published diagnostics stay in place until the next successful run.
      logger.error(`analysis failed: ${describeError(error)}`);
    },
  });

  function publish(entries: readonly DocumentDiagnostics[]): void {
    for (const entry of entries) {
      const version = documents.versionOf(entry.uri);
      try {
        options.publishDiagnostics({
          uri: entry.uri,
          ...(version !== undefined ? { version } : {}),
          diagnostics: entry.diagnostics,
        });
      } catch (error) {
        logger.exception(`failed to publish diagnostics for ${entry.uri}`, error);
      }
    }
  }

  /** Snapshot of open document versions, used to reject stale publishes. */
  function versionSnapshot(): ReadonlyMap<string, number> {
    const snapshot = new Map<string, number>();
    for (const doc of documents.all()) snapshot.set(doc.uri, doc.version);
    return snapshot;
  }

  function versionsChanged(before: ReadonlyMap<string, number>): boolean {
    const now = versionSnapshot();
    if (now.size !== before.size) return true;
    for (const [uri, version] of before) {
      if (now.get(uri) !== version) return true;
    }
    return false;
  }

  async function runAnalysis(
    signal: AbortSignal,
    isStale: () => boolean,
  ): Promise<void> {
    if (state !== "initialized" || projects.length === 0) return;

    const settings = projects[0]!.settings();
    logger.setLevel(settings.logLevel);
    scheduler.setDebounce(settings.debounce);

    if (!settings.enabled) {
      publish(index.releaseAll());
      return;
    }

    const before = versionSnapshot();
    const found: Parameters<DiagnosticIndex["publishSet"]>[0][number][] = [];

    for (const project of projects) {
      if (signal.aborted || isStale()) return;
      try {
        const analysis = await project.analyze({ signal });
        found.push(...analysis.diagnostics);
        for (const error of analysis.errors) logger.warn(error);
        logger.debug(
          `${project.root}: ${analysis.diagnostics.length} diagnostics in ` +
            `${Math.round(analysis.durationMs)}ms (cached scopes: ${analysis.cachedScopes})`,
        );
      } catch (error) {
        if (signal.aborted || isStale()) return;
        // Keep serving whatever the other projects produced.
        logger.exception(`analysis failed for ${project.root}`, error);
      }
    }

    // Diagnostics must describe the document state that was analyzed.
    if (signal.aborted || isStale()) {
      logger.debug("discarding stale analysis results");
      return;
    }
    if (versionsChanged(before)) {
      logger.debug("discarding results for outdated document versions");
      return;
    }

    publish(
      index.publishSet(found, {
        limitPerFile: settings.maxDiagnosticsPerFile,
      }),
    );
  }

  function pathOf(uri: string): string | undefined {
    const filePath = uriToPath(uri, platform);
    return filePath === undefined ? undefined : normalizePath(filePath, platform);
  }

  function invalidate(filePath: string): void {
    const matching = projects.filter((project) =>
      isWithin(project.root, filePath, platform),
    );
    const targets = matching.length > 0 ? matching : projects;
    for (const project of targets) project.invalidateFile(filePath);
  }

  function createProjects(folders: readonly string[]): Project[] {
    const created: Project[] = [];
    for (const folder of folders) {
      try {
        created.push(
          createProject({
            folder,
            logger,
            platform,
            overrides,
            io: {
              fs: overlayFs,
              fileExists: readers.fileExists,
              readFile: readers.readFile,
              readDir: readers.readDir,
              textOf: (absolutePath) => documents.textOfPath(absolutePath),
            },
          }),
        );
      } catch (error) {
        // A folder we cannot resolve must not prevent the others from working.
        logger.exception(`failed to initialize project at ${folder}`, error);
      }
    }
    return created;
  }

  function applyOverrides(next: LanguageServerConfig): void {
    overrides = next;
    for (const project of projects) project.setOverrides(next);
    if (next.logLevel) logger.setLevel(next.logLevel);
    if (next.debounce !== undefined) scheduler.setDebounce(next.debounce);
  }

  return {
    get state() {
      return state;
    },
    logger,
    documents,

    initialize(params) {
      const folders = resolveWorkspaceRoots(params, {
        platform,
        ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      });
      const fromInit = readLanguageServerSettings(
        params.initializationOptions,
        logger,
      );
      if (fromInit) {
        overrides = { ...overrides, ...fromInit };
        if (fromInit.logLevel) logger.setLevel(fromInit.logLevel);
        if (fromInit.debounce !== undefined) {
          scheduler.setDebounce(fromInit.debounce);
        }
      }

      projects = createProjects(folders);
      state = "initialized";
      logger.info(
        `initialized with ${projects.length} project(s): ${projects
          .map((p) => p.root)
          .join(", ")}`,
      );

      return {
        capabilities: {
          textDocumentSync: {
            openClose: true,
            change: TextDocumentSyncKind.Incremental,
          },
          workspace: {
            workspaceFolders: {
              supported: true,
              changeNotifications: true,
            },
          },
        },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      };
    },

    initialized() {
      try {
        options.onRegisterWatchers?.();
      } catch (error) {
        logger.exception("watcher registration failed", error);
      }
      scheduler.scheduleNow("initialized");
    },

    didOpen(params) {
      const document = documents.open({
        uri: params.textDocument.uri,
        languageId: params.textDocument.languageId ?? "plaintext",
        version: params.textDocument.version ?? 0,
        text: params.textDocument.text,
      });
      if (!document) {
        logger.debug(`ignoring non-file document ${params.textDocument.uri}`);
        return;
      }
      invalidate(document.path);
      // First diagnostics for a freshly opened file should not wait a debounce.
      scheduler.scheduleNow(`didOpen ${document.path}`);
    },

    didChange(params) {
      const document = documents.change({
        uri: params.textDocument.uri,
        version: params.textDocument.version ?? 0,
        changes: params.contentChanges,
      });
      if (!document) {
        logger.debug(`didChange for untracked ${params.textDocument.uri}`);
        return;
      }
      invalidate(document.path);
      scheduler.schedule(`didChange ${document.path}@${document.version}`);
    },

    didClose(params) {
      const closed = documents.close(params.textDocument.uri);
      const filePath = closed?.path ?? pathOf(params.textDocument.uri);
      if (filePath === undefined) return;
      // Release ownership immediately so nothing is left behind.
      const release = index.release(filePath);
      if (release) publish([release]);
      // On-disk contents govern again, so the file must be re-analyzed.
      invalidate(filePath);
      scheduler.schedule(`didClose ${filePath}`);
    },

    didSave(params) {
      const filePath = pathOf(params.textDocument.uri);
      if (filePath === undefined) return;
      invalidate(filePath);
      scheduler.schedule(`didSave ${filePath}`);
    },

    didChangeConfiguration(params) {
      const next = readLanguageServerSettings(params.settings, logger);
      if (next) applyOverrides({ ...overrides, ...next });
      // Config may change rules or ignore patterns, so redo everything.
      for (const project of projects) {
        project.refresh();
        project.cache.invalidateAll();
      }
      scheduler.schedule("didChangeConfiguration");
    },

    didChangeWatchedFiles(params) {
      let relevant = 0;
      for (const change of params.changes) {
        const filePath = pathOf(change.uri);
        if (filePath === undefined) continue;
        // Open buffers are authoritative; disk events for them add nothing.
        if (
          change.type !== FileChangeType.Deleted &&
          documents.getByPath(filePath)
        ) {
          continue;
        }
        invalidate(filePath);
        relevant += 1;
      }
      if (relevant > 0) scheduler.schedule(`watched ${relevant} file(s)`);
    },

    didChangeWorkspaceFolders(params) {
      const removed = params.event.removed ?? [];
      const added = params.event.added ?? [];

      if (removed.length > 0) {
        const removedRoots = removed
          .map((folder) => pathOf(folder.uri))
          .filter((value): value is string => value !== undefined);
        projects = projects.filter(
          (project) =>
            !removedRoots.some((root) =>
              isWithin(root, project.root, platform),
            ),
        );
      }
      if (added.length > 0) {
        const addedRoots = added
          .map((folder) => pathOf(folder.uri))
          .filter((value): value is string => value !== undefined);
        projects = [...projects, ...createProjects(addedRoots)];
      }

      // Ownership is recomputed from scratch for the new folder set.
      publish(index.releaseAll());
      scheduler.schedule("didChangeWorkspaceFolders");
    },

    async shutdown() {
      scheduler.cancel();
      await scheduler.settle();
      publish(index.releaseAll());
      documents.clear();
      projects = [];
      state = "shutdown";
      logger.info("shutdown complete");
    },

    exit() {
      scheduler.dispose();
      const code = state === "shutdown" ? 0 : 1;
      state = "exited";
      options.onExit?.(code);
    },

    settle() {
      return scheduler.settle();
    },

    settings() {
      return projects[0]?.settings();
    },
  };
}

/**
 * Extracts `languageServer` settings from `initializationOptions` or
 * `workspace/didChangeConfiguration`.
 *
 * Accepts the shapes IDE clients actually send (`i18nDoctor`, `i18n-doctor`, or
 * a bare `languageServer` object) and validates them with the same validator
 * the config file uses, so there is only one schema.
 */
export function readLanguageServerSettings(
  raw: unknown,
  logger?: Logger,
): LanguageServerConfig | undefined {
  const candidate = findLanguageServerBlock(raw);
  if (candidate === undefined) return undefined;

  const { config, diagnostics } = validateUserConfig({
    languageServer: candidate,
  });
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") logger?.error(diagnostic.message);
    else logger?.warn(diagnostic.message);
  }
  return config.languageServer;
}

function findLanguageServerBlock(raw: unknown): unknown {
  if (!isRecord(raw)) return undefined;

  if (isRecord(raw.languageServer)) return raw.languageServer;

  for (const key of ["i18nDoctor", "i18n-doctor", "i18n_doctor"]) {
    const section = raw[key];
    if (isRecord(section) && isRecord(section.languageServer)) {
      return section.languageServer;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export { createNullSink };
