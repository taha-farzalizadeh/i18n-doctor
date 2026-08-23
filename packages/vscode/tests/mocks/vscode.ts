/**
 * In-memory stand-in for the `vscode` module (aliased in vitest.config.ts).
 *
 * Implements just enough surface for the extension sources and for importing
 * vscode-languageclient. Tests drive it through the `__mock` control object.
 */

import * as nodePath from "node:path";

/* -------------------------------------------------------------------- */
/* Basic types                                                           */
/* -------------------------------------------------------------------- */

export class Disposable {
  constructor(private readonly callOnDispose?: () => void) {}
  dispose(): void {
    this.callOnDispose?.();
  }
  static from(...disposables: { dispose(): void }[]): Disposable {
    return new Disposable(() => {
      for (const d of disposables) d.dispose();
    });
  }
}

class EventEmitterImpl<T> {
  private readonly listeners = new Set<(value: T) => void>();
  readonly event = (listener: (value: T) => void): Disposable => {
    this.listeners.add(listener);
    return new Disposable(() => this.listeners.delete(listener));
  };
  fire(value: T): void {
    for (const listener of [...this.listeners]) listener(value);
  }
  clear(): void {
    this.listeners.clear();
  }
  dispose(): void {
    this.clear();
  }
}

export { EventEmitterImpl as EventEmitter };

/* -------------------------------------------------------------------- */
/* Test control surface                                                  */
/* -------------------------------------------------------------------- */

export interface MockWorkspaceFolder {
  readonly uri: Uri;
  readonly name: string;
  readonly index: number;
}

interface MockState {
  /** Explicitly-set settings, keyed by full id (`i18nDoctor.enabled`). */
  settings: Map<string, unknown>;
  workspaceFolders: MockWorkspaceFolder[];
  /** Files served by `workspace.fs.readFile`, keyed by fsPath. */
  files: Map<string, string>;
  /** Results returned by `workspace.findFiles`. */
  findFilesResults: Uri[];
  errorMessages: string[];
  warningMessages: string[];
  outputLines: string[];
  commands: Map<string, (...args: unknown[]) => unknown>;
  watchers: MockFileSystemWatcher[];
}

function freshState(): MockState {
  return {
    settings: new Map(),
    workspaceFolders: [],
    files: new Map(),
    findFilesResults: [],
    errorMessages: [],
    warningMessages: [],
    outputLines: [],
    commands: new Map(),
    watchers: [],
  };
}

const state: MockState = freshState();

const configurationEmitter = new EventEmitterImpl<{
  affectsConfiguration(section: string): boolean;
}>();
const workspaceFoldersEmitter = new EventEmitterImpl<unknown>();

export const __mock = {
  state,
  reset(): void {
    Object.assign(state, freshState());
    configurationEmitter.clear();
    workspaceFoldersEmitter.clear();
  },
  setSetting(key: string, value: unknown): void {
    state.settings.set(key, value);
  },
  addWorkspaceFolder(fsPath: string, name?: string): void {
    state.workspaceFolders.push({
      uri: Uri.file(fsPath),
      name: name ?? nodePath.basename(fsPath),
      index: state.workspaceFolders.length,
    });
  },
  fireConfigurationChange(changedSection: string): void {
    configurationEmitter.fire({
      affectsConfiguration: (section) =>
        changedSection === section ||
        changedSection.startsWith(`${section}.`) ||
        section.startsWith(`${changedSection}.`),
    });
  },
  fireWorkspaceFoldersChange(): void {
    workspaceFoldersEmitter.fire({});
  },
  fireConfigFileCreated(fsPath: string): void {
    for (const watcher of state.watchers) {
      watcher.__fireCreate(Uri.file(fsPath));
    }
  },
};

/* -------------------------------------------------------------------- */
/* URI and protocol types                                                */
/* -------------------------------------------------------------------- */

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly authority: string,
    readonly path: string,
    readonly query: string,
    readonly fragment: string,
  ) {}

  static file(fsPath: string): Uri {
    return new Uri("file", "", fsPath, "", "");
  }

  static parse(value: string): Uri {
    const match = /^([a-z][a-z0-9+.-]*):\/\/([^/]*)(.*)$/i.exec(value);
    if (match) {
      return new Uri(match[1]!, match[2]!, match[3] ?? "", "", "");
    }
    return new Uri("file", "", value, "", "");
  }

  static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri(
      base.scheme,
      base.authority,
      nodePath.join(base.path, ...segments),
      base.query,
      base.fragment,
    );
  }

  get fsPath(): string {
    return this.path;
  }

  with(change: Partial<Pick<Uri, "scheme" | "path" | "query">>): Uri {
    return new Uri(
      change.scheme ?? this.scheme,
      this.authority,
      change.path ?? this.path,
      change.query ?? this.query,
      this.fragment,
    );
  }

  toString(): string {
    return `${this.scheme}://${this.authority}${this.path}`;
  }
}

export class Position {
  constructor(
    readonly line: number,
    readonly character: number,
  ) {}
}

export class Range {
  constructor(
    readonly start: Position,
    readonly end: Position,
  ) {}
}

export class Diagnostic {
  constructor(
    readonly range: Range,
    readonly message: string,
    readonly severity?: number,
  ) {}
}

export class CancellationError extends Error {}

export class CancellationTokenSource {
  token = { isCancellationRequested: false, onCancellationRequested: new EventEmitterImpl<void>().event };
  cancel(): void {
    this.token.isCancellationRequested = true;
  }
  dispose(): void {}
}

export const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 } as const;
export const DiagnosticTag = { Unnecessary: 1, Deprecated: 2 } as const;

export const CodeActionKind = {
  Empty: { value: "", append: (v: string) => ({ value: v }) },
};

export const version = "1.90.0";

export const env = {
  appName: "mock-vscode",
  language: "en",
  machineId: "mock-machine",
  sessionId: "mock-session",
  uriScheme: "vscode",
};

export const l10n = {
  t: (message: string, ..._args: unknown[]): string => message,
};

/* -------------------------------------------------------------------- */
/* workspace                                                             */
/* -------------------------------------------------------------------- */

const SETTING_DEFAULTS: Record<string, unknown> = {
  "i18nDoctor.enabled": true,
  "i18nDoctor.languageServer.debounce": 250,
  "i18nDoctor.languageServer.logLevel": "error",
  "i18nDoctor.languageServer.maxDiagnosticsPerFile": 500,
  "i18nDoctor.languageServer.coverage": true,
  "i18nDoctor.languageServer.path": "",
};

class MockFileSystemWatcher {
  private readonly createEmitter = new EventEmitterImpl<Uri>();
  readonly onDidCreate = this.createEmitter.event;
  readonly onDidChange = new EventEmitterImpl<Uri>().event;
  readonly onDidDelete = new EventEmitterImpl<Uri>().event;
  __fireCreate(uri: Uri): void {
    this.createEmitter.fire(uri);
  }
  dispose(): void {}
}

export const workspace = {
  get workspaceFolders(): readonly MockWorkspaceFolder[] | undefined {
    return state.workspaceFolders.length > 0
      ? state.workspaceFolders
      : undefined;
  },

  getConfiguration(section?: string) {
    const prefix = section !== undefined ? `${section}.` : "";
    return {
      get<T>(key: string): T | undefined {
        const full = `${prefix}${key}`;
        if (state.settings.has(full)) return state.settings.get(full) as T;
        return SETTING_DEFAULTS[full] as T | undefined;
      },
      inspect<T>(key: string): { globalValue?: T } | undefined {
        const full = `${prefix}${key}`;
        if (state.settings.has(full)) {
          return { globalValue: state.settings.get(full) as T };
        }
        return {};
      },
      has(key: string): boolean {
        return (
          state.settings.has(`${prefix}${key}`) ||
          `${prefix}${key}` in SETTING_DEFAULTS
        );
      },
      update(): Promise<void> {
        return Promise.resolve();
      },
    };
  },

  onDidChangeConfiguration: configurationEmitter.event,
  onDidChangeWorkspaceFolders: workspaceFoldersEmitter.event,

  createFileSystemWatcher(_glob: string): MockFileSystemWatcher {
    const watcher = new MockFileSystemWatcher();
    state.watchers.push(watcher);
    return watcher;
  },

  findFiles(
    _include: string,
    _exclude?: string,
    maxResults?: number,
  ): Promise<Uri[]> {
    const results =
      maxResults !== undefined
        ? state.findFilesResults.slice(0, maxResults)
        : [...state.findFilesResults];
    return Promise.resolve(results);
  },

  fs: {
    readFile(uri: Uri): Promise<Uint8Array> {
      const contents = state.files.get(uri.fsPath);
      if (contents === undefined) {
        return Promise.reject(new Error(`ENOENT: ${uri.fsPath}`));
      }
      return Promise.resolve(new TextEncoder().encode(contents));
    },
  },

  textDocuments: [] as unknown[],
  onDidOpenTextDocument: new EventEmitterImpl<unknown>().event,
  onDidChangeTextDocument: new EventEmitterImpl<unknown>().event,
  onDidCloseTextDocument: new EventEmitterImpl<unknown>().event,
  onDidSaveTextDocument: new EventEmitterImpl<unknown>().event,
};

/* -------------------------------------------------------------------- */
/* window / commands / languages / extensions                            */
/* -------------------------------------------------------------------- */

export const window = {
  createOutputChannel(name: string) {
    return {
      name,
      appendLine(line: string): void {
        state.outputLines.push(line);
      },
      append(text: string): void {
        state.outputLines.push(text);
      },
      replace(): void {},
      clear(): void {},
      show(): void {},
      hide(): void {},
      dispose(): void {},
    };
  },
  showErrorMessage(message: string): Promise<undefined> {
    state.errorMessages.push(message);
    return Promise.resolve(undefined);
  },
  showWarningMessage(message: string): Promise<undefined> {
    state.warningMessages.push(message);
    return Promise.resolve(undefined);
  },
  showInformationMessage(): Promise<undefined> {
    return Promise.resolve(undefined);
  },
  activeTextEditor: undefined,
};

export const commands = {
  registerCommand(
    id: string,
    handler: (...args: unknown[]) => unknown,
  ): Disposable {
    state.commands.set(id, handler);
    return new Disposable(() => state.commands.delete(id));
  },
  executeCommand(id: string, ...args: unknown[]): Promise<unknown> {
    const handler = state.commands.get(id);
    return Promise.resolve(handler?.(...args));
  },
};

export const languages = {
  createDiagnosticCollection(name?: string) {
    return {
      name,
      set(): void {},
      delete(): void {},
      clear(): void {},
      dispose(): void {},
    };
  },
  match(): number {
    return 1;
  },
  getDiagnostics(): unknown[] {
    return [];
  },
};

export const extensions = {
  getExtension(): undefined {
    return undefined;
  },
  all: [] as unknown[],
};
