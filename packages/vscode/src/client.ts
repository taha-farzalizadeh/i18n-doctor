/**
 * Real vscode-languageclient binding.
 *
 * Lifecycle logic lives in `lifecycle.ts` so it can be unit-tested without
 * loading the `vscode` module (which only exists inside the extension host).
 */

import type * as vscode from "vscode";
import {
  LanguageClient,
  TransportKind,
  type ErrorHandler as LspErrorHandler,
  type LanguageClientOptions,
  type ServerOptions,
} from "vscode-languageclient/node";
import {
  toInitializationOptions,
  type ExtensionSettings,
} from "./configuration.js";
import {
  createErrorHandler,
  DOCUMENT_SELECTOR,
} from "./lifecycle.js";
import type { ServerModule } from "./server.js";

export {
  ClientController,
  CloseAction,
  createErrorHandler,
  DOCUMENT_SELECTOR,
  ErrorAction,
} from "./lifecycle.js";
export type {
  ClientControllerDeps,
  CloseHandlerResult,
  ErrorHandler,
  ErrorHandlerOptions,
  ErrorHandlerResult,
  ManagedClient,
} from "./lifecycle.js";

/** Creates the real LanguageClient bound to the given server module. */
export function createLanguageClient(
  server: ServerModule,
  settings: ExtensionSettings,
  outputChannel: vscode.OutputChannel,
  onPermanentFailure: (message: string) => void,
): LanguageClient {
  const serverOptions: ServerOptions = {
    run: { module: server.module, transport: TransportKind.stdio },
    debug: {
      module: server.module,
      transport: TransportKind.stdio,
      options: { execArgv: ["--nolazy", "--inspect=6019"] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: DOCUMENT_SELECTOR,
    initializationOptions: toInitializationOptions(settings),
    outputChannel,
    // Structurally compatible with vscode-languageclient's ErrorHandler; the
    // numeric action values match CloseAction / ErrorAction exactly.
    errorHandler: createErrorHandler({
      onPermanentFailure,
    }) as unknown as LspErrorHandler,
    // No `workspaceFolder` restriction: the client forwards every workspace
    // folder in `initialize`, and the server discovers projects per folder.
  };

  return new LanguageClient(
    "i18nDoctor",
    "i18n-doctor",
    serverOptions,
    clientOptions,
  );
}
