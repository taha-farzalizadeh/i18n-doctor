/**
 * Client lifecycle and crash policy — no dependency on vscode-languageclient,
 * so it is fully unit-testable outside the extension host.
 *
 * The real LanguageClient binding lives in `client.ts`.
 */

import {
  toConfigurationParams,
  type ExtensionSettings,
} from "./configuration.js";
import type { ResolveServerModuleResult, ServerModule } from "./server.js";

/**
 * Everything the analyzer understands: the four source dialects plus the
 * catalog formats. The server ignores documents that are not part of a
 * discovered project.
 */
export const DOCUMENT_SELECTOR = [
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
  "json",
  "jsonc",
  "yaml",
].flatMap((language) => [
  { scheme: "file", language },
  { scheme: "untitled", language },
]);

/** Matches `vscode-languageclient`'s `ErrorAction` numeric values. */
export const ErrorAction = {
  Continue: 1,
  Shutdown: 2,
} as const;

/** Matches `vscode-languageclient`'s `CloseAction` numeric values. */
export const CloseAction = {
  DoNotRestart: 1,
  Restart: 2,
} as const;

export type ErrorActionValue =
  (typeof ErrorAction)[keyof typeof ErrorAction];
export type CloseActionValue =
  (typeof CloseAction)[keyof typeof CloseAction];

export interface ErrorHandlerResult {
  readonly action: ErrorActionValue;
  readonly handled?: boolean;
}

export interface CloseHandlerResult {
  readonly action: CloseActionValue;
  readonly handled?: boolean;
}

export interface ErrorHandler {
  error(
    error: Error,
    message: unknown,
    count: number | undefined,
  ): ErrorHandlerResult;
  closed(): CloseHandlerResult;
}

export interface ErrorHandlerOptions {
  /** Crashes tolerated inside {@link ErrorHandlerOptions.windowMs}. */
  readonly maxRestarts?: number;
  readonly windowMs?: number;
  /** Injectable clock for tests. */
  readonly now?: () => number;
  /** Invoked once the crash budget is exhausted. */
  readonly onPermanentFailure: (message: string) => void;
}

/**
 * Restarts the server after a crash, but gives up (with a user-visible
 * message) when it keeps crashing, so a broken install cannot spin-loop.
 */
export function createErrorHandler(options: ErrorHandlerOptions): ErrorHandler {
  const maxRestarts = options.maxRestarts ?? 4;
  const windowMs = options.windowMs ?? 3 * 60_000;
  const now = options.now ?? Date.now;
  let crashes: number[] = [];

  return {
    error(_error, _message, count): ErrorHandlerResult {
      const action =
        count !== undefined && count <= 3
          ? ErrorAction.Continue
          : ErrorAction.Shutdown;
      return { action, handled: true };
    },

    closed(): CloseHandlerResult {
      const timestamp = now();
      crashes = crashes.filter((t) => timestamp - t < windowMs);
      crashes.push(timestamp);
      if (crashes.length <= maxRestarts) {
        return { action: CloseAction.Restart, handled: true };
      }
      options.onPermanentFailure(
        `The i18n-doctor language server crashed ${crashes.length} times in ` +
          "a short period and will not be restarted. Check the i18n-doctor " +
          'output channel for details, then run "i18n-doctor: Restart ' +
          'Language Server" to try again.',
      );
      return { action: CloseAction.DoNotRestart, handled: true };
    },
  };
}

/** The subset of LanguageClient the controller drives. */
export interface ManagedClient {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendNotification(method: string, params: unknown): Promise<void>;
}

export interface ClientControllerDeps {
  readSettings(): ExtensionSettings;
  resolveServer(
    explicitPath: string | undefined,
  ): ResolveServerModuleResult;
  createClient(
    server: ServerModule,
    settings: ExtensionSettings,
  ): ManagedClient;
  showError(message: string): void;
  log?(message: string): void;
}

const DID_CHANGE_CONFIGURATION = "workspace/didChangeConfiguration";

/**
 * Owns the client lifecycle: starting when enabled, forwarding configuration
 * changes, restarting when the server module changes, and shutting down
 * cleanly so no server process outlives the extension.
 */
export class ClientController {
  private client: ManagedClient | undefined;
  private startedWith: ExtensionSettings | undefined;
  private lastSettings: ExtensionSettings;
  private transition: Promise<void> = Promise.resolve();

  constructor(private readonly deps: ClientControllerDeps) {
    this.lastSettings = deps.readSettings();
  }

  isRunning(): boolean {
    return this.client !== undefined;
  }

  /** Starts the client if enabled; resolves once startup settled. */
  start(): Promise<void> {
    return this.enqueue(() => this.doStart());
  }

  stop(): Promise<void> {
    return this.enqueue(() => this.doStop());
  }

  restart(): Promise<void> {
    return this.enqueue(async () => {
      await this.doStop();
      await this.doStart();
    });
  }

  /**
   * Reacts to `i18nDoctor.*` changes: toggling `enabled` starts/stops the
   * client, changing the server path restarts it, and everything else is
   * forwarded live through `workspace/didChangeConfiguration`.
   */
  onConfigurationChanged(): Promise<void> {
    return this.enqueue(async () => {
      const previous = this.lastSettings;
      const next = this.deps.readSettings();
      this.lastSettings = next;

      if (!next.enabled) {
        if (this.client !== undefined) await this.doStop();
        return;
      }
      if (this.client === undefined) {
        if (!previous.enabled) await this.doStart();
        return;
      }
      if (next.serverPath !== this.startedWith?.serverPath) {
        await this.doStop();
        await this.doStart();
        return;
      }
      try {
        await this.client.sendNotification(
          DID_CHANGE_CONFIGURATION,
          toConfigurationParams(next),
        );
      } catch (error) {
        this.deps.log?.(`configuration forwarding failed: ${String(error)}`);
      }
    });
  }

  /** Stops the client; safe to call multiple times. */
  dispose(): Promise<void> {
    return this.stop();
  }

  private async doStart(): Promise<void> {
    if (this.client !== undefined) return;

    const settings = this.deps.readSettings();
    this.lastSettings = settings;
    if (!settings.enabled) return;

    const resolution = this.deps.resolveServer(settings.serverPath);
    if (resolution.server === undefined) {
      this.deps.showError(
        resolution.error ?? "The i18n-doctor language server was not found.",
      );
      return;
    }

    this.deps.log?.(
      `starting language server (${resolution.server.kind}): ` +
        resolution.server.module,
    );
    const client = this.deps.createClient(resolution.server, settings);
    try {
      await client.start();
      this.client = client;
      this.startedWith = settings;
    } catch (error) {
      try {
        await client.stop();
      } catch {
        // Already dead; nothing to clean up.
      }
      this.deps.showError(
        `The i18n-doctor language server failed to start: ${describe(error)}`,
      );
    }
  }

  private async doStop(): Promise<void> {
    const client = this.client;
    if (client === undefined) return;
    this.client = undefined;
    this.startedWith = undefined;
    try {
      await client.stop();
      this.deps.log?.("language server stopped");
    } catch (error) {
      this.deps.log?.(`language server stop failed: ${describe(error)}`);
    }
  }

  /** Serializes lifecycle transitions so start/stop can never interleave. */
  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.transition.then(task, task);
    this.transition = next.catch(() => undefined);
    return next;
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
