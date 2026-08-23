import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { onTestFinished } from "vitest";
import { createNullSink } from "../src/logger.js";
import type { Diagnostic, PublishDiagnosticsParams } from "../src/protocol.js";
import { createServerCore, type ServerCore } from "../src/server.js";
import { pathToUri } from "../src/workspace.js";

/** Creates a temp project from a path → contents map. Removed after the test. */
export async function fixture(
  files: Record<string, string>,
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "i18n-ls-"));
  onTestFinished(async () => {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  });
  await writeFiles(root, files);
  return root;
}

export async function writeFiles(
  root: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content, "utf8");
  }
}

export async function removeFile(
  root: string,
  relative: string,
): Promise<void> {
  await rm(path.join(root, relative), { force: true });
}

export function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export type WatchedKind = "created" | "changed" | "deleted";

export interface WatchedChange {
  readonly relativePath: string;
  readonly type?: WatchedKind;
}

export interface Harness {
  readonly core: ServerCore;
  readonly root: string;
  uri(relative: string): string;
  /** Runs initialize + initialized and waits for the first analysis. */
  start(): Promise<void>;
  open(relative: string, text: string, version?: number): Promise<void>;
  /** Replaces the whole document, then waits for analysis to settle. */
  change(relative: string, text: string, version: number): Promise<void>;
  /** Sends didChange without waiting, for debounce/staleness assertions. */
  changeNoWait(relative: string, text: string, version: number): void;
  close(relative: string): Promise<void>;
  /** Simulates on-disk changes reported by the client's file watcher. */
  watched(changes: readonly WatchedChange[]): Promise<void>;
  /** Sends a didSave notification, then waits for analysis to settle. */
  save(relative: string): Promise<void>;
  /** Removes a workspace folder, as a client would on folder close. */
  removeFolder(folder: string): Promise<void>;
  /** Adds a workspace folder, as a client would on folder open. */
  addFolder(folder: string): Promise<void>;
  /** Pushes new client settings via workspace/didChangeConfiguration. */
  configure(settings: unknown): Promise<void>;
  settle(): Promise<void>;
  /** Latest published diagnostics for a file (empty when cleared or unseen). */
  diagnosticsFor(relative: string): readonly Diagnostic[];
  /** Latest published diagnostics keyed by workspace-relative path. */
  snapshot(): Record<string, readonly Diagnostic[]>;
  codesFor(relative: string): readonly (string | undefined)[];
  /** Every publish the server produced since the last `reset()`, in order. */
  publishes(): readonly PublishDiagnosticsParams[];
  publishCountFor(relative: string): number;
  reset(): void;
}

export interface HarnessOptions {
  readonly debounce?: number;
  readonly logLevel?: "silent" | "error" | "warn" | "info" | "debug";
  readonly initializationOptions?: unknown;
  /** Pass workspace folders instead of a single rootUri. */
  readonly folders?: readonly string[];
  /** Observes every publish; throwing here simulates a broken transport. */
  readonly onPublish?: (params: PublishDiagnosticsParams) => void;
  /**
   * Skips the harness's programmatic debounce/logLevel overrides so the
   * project's own config decides. Tests get real (slower) debounce values.
   */
  readonly respectConfig?: boolean;
}

export function harness(root: string, options: HarnessOptions = {}): Harness {
  const publishes: PublishDiagnosticsParams[] = [];
  const latest = new Map<string, readonly Diagnostic[]>();

  const core = createServerCore({
    publishDiagnostics: (params) => {
      publishes.push(params);
      latest.set(params.uri, params.diagnostics);
      options.onPublish?.(params);
    },
    logSink: createNullSink(),
    ...(options.respectConfig
      ? {
          ...(options.logLevel ? { logLevel: options.logLevel } : {}),
          ...(options.debounce !== undefined
            ? { debounce: options.debounce }
            : {}),
        }
      : {
          logLevel: options.logLevel ?? "silent",
          debounce: options.debounce ?? 0,
        }),
    cwd: root,
  });

  const uri = (relative: string): string =>
    pathToUri(path.join(root, relative));

  const languageIdOf = (relative: string): string => {
    switch (path.extname(relative)) {
      case ".ts":
        return "typescript";
      case ".tsx":
        return "typescriptreact";
      case ".js":
        return "javascript";
      case ".jsx":
        return "javascriptreact";
      case ".json":
        return "json";
      default:
        return "plaintext";
    }
  };

  const WATCHED_KIND: Readonly<Record<WatchedKind, 1 | 2 | 3>> = {
    created: 1,
    changed: 2,
    deleted: 3,
  };

  return {
    core,
    root,
    uri,

    async start() {
      core.initialize({
        processId: process.pid,
        ...(options.folders
          ? { workspaceFolders: options.folders.map((f) => ({ uri: pathToUri(f) })) }
          : { rootUri: pathToUri(root) }),
        capabilities: {
          workspace: { didChangeWatchedFiles: { dynamicRegistration: true } },
        },
        ...(options.initializationOptions !== undefined
          ? { initializationOptions: options.initializationOptions }
          : {}),
      });
      core.initialized();
      await core.settle();
    },

    async open(relative, text, version = 1) {
      core.didOpen({
        textDocument: {
          uri: uri(relative),
          languageId: languageIdOf(relative),
          version,
          text,
        },
      });
      await core.settle();
    },

    async change(relative, text, version) {
      core.didChange({
        textDocument: { uri: uri(relative), version },
        contentChanges: [{ text }],
      });
      await core.settle();
    },

    changeNoWait(relative, text, version) {
      core.didChange({
        textDocument: { uri: uri(relative), version },
        contentChanges: [{ text }],
      });
    },

    async close(relative) {
      core.didClose({ textDocument: { uri: uri(relative) } });
      await core.settle();
    },

    async watched(changes) {
      core.didChangeWatchedFiles({
        changes: changes.map((change) => ({
          uri: uri(change.relativePath),
          type: WATCHED_KIND[change.type ?? "changed"],
        })),
      });
      await core.settle();
    },

    async save(relative) {
      core.didSave({ textDocument: { uri: uri(relative) } });
      await core.settle();
    },

    async removeFolder(folder) {
      core.didChangeWorkspaceFolders({
        event: { added: [], removed: [{ uri: pathToUri(folder) }] },
      });
      await core.settle();
    },

    async addFolder(folder) {
      core.didChangeWorkspaceFolders({
        event: { added: [{ uri: pathToUri(folder) }], removed: [] },
      });
      await core.settle();
    },

    async configure(settings) {
      core.didChangeConfiguration({ settings });
      await core.settle();
    },

    settle() {
      return core.settle();
    },

    diagnosticsFor(relative) {
      return latest.get(uri(relative)) ?? [];
    },

    snapshot() {
      const out: Record<string, readonly Diagnostic[]> = {};
      for (const [documentUri, diagnostics] of latest) {
        if (diagnostics.length === 0) continue;
        out[relativeOf(root, documentUri)] = diagnostics;
      }
      return out;
    },

    codesFor(relative) {
      return this.diagnosticsFor(relative).map((d) => d.code);
    },

    publishes() {
      return publishes;
    },

    publishCountFor(relative) {
      const target = uri(relative);
      return publishes.filter((p) => p.uri === target).length;
    },

    reset() {
      publishes.length = 0;
    },
  };
}

function relativeOf(root: string, documentUri: string): string {
  const filePath = documentUri.replace(/^file:\/\//, "");
  const decoded = decodeURIComponent(filePath);
  return path.relative(root, decoded).split(path.sep).join("/");
}

/** Range as a compact `startLine:startChar-endLine:endChar` string. */
export function rangeOf(diagnostic: Diagnostic): string {
  const { start, end } = diagnostic.range;
  return `${start.line}:${start.character}-${end.line}:${end.character}`;
}

/** The exact text a diagnostic underlines. */
export function underlined(text: string, diagnostic: Diagnostic): string {
  const lines = text.split(/\r\n|\r|\n/);
  const { start, end } = diagnostic.range;
  if (start.line === end.line) {
    return (lines[start.line] ?? "").slice(start.character, end.character);
  }
  const parts = [(lines[start.line] ?? "").slice(start.character)];
  for (let line = start.line + 1; line < end.line; line += 1) {
    parts.push(lines[line] ?? "");
  }
  parts.push((lines[end.line] ?? "").slice(0, end.character));
  return parts.join("\n");
}

export function find(
  diagnostics: readonly Diagnostic[],
  code: string,
  key?: string,
): Diagnostic | undefined {
  return diagnostics.find(
    (d) => d.code === code && (key === undefined || d.data?.key === key),
  );
}
