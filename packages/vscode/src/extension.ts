/**
 * VS Code entry point. Deliberately thin: reads settings, decides whether the
 * workspace is i18n-relevant, and delegates everything else to
 * ClientController. All diagnostics come from the language server.
 */

import * as vscode from "vscode";
import { createLanguageClient } from "./client.js";
import { ClientController } from "./lifecycle.js";
import {
  CONFIG_SECTION,
  packageJsonMentionsI18n,
  readSettings,
} from "./configuration.js";
import { resolveServerModule } from "./server.js";

const CONFIG_GLOB = "**/i18n-doctor.config.{ts,js,mjs,cjs,json}";

let controller: ClientController | undefined;

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel("i18n-doctor");
  context.subscriptions.push(outputChannel);

  const showError = (message: string): void => {
    outputChannel.appendLine(`[error] ${message}`);
    void vscode.window.showErrorMessage(message);
  };

  controller = new ClientController({
    readSettings: () =>
      readSettings(vscode.workspace.getConfiguration(CONFIG_SECTION)),
    resolveServer: (explicitPath) =>
      resolveServerModule({
        extensionRoot: context.extensionPath,
        explicitPath,
      }),
    createClient: (server, settings) =>
      createLanguageClient(server, settings, outputChannel, showError),
    showError,
    log: (message) => outputChannel.appendLine(message),
  });
  const active = controller;

  const startIfRelevant = async (): Promise<void> => {
    if (active.isRunning()) return;
    if (!(await workspaceLooksRelevant())) return;
    await active.start();
  };

  const configWatcher = vscode.workspace.createFileSystemWatcher(CONFIG_GLOB);
  context.subscriptions.push(
    configWatcher,
    configWatcher.onDidCreate(() => void startIfRelevant()),
    vscode.commands.registerCommand("i18nDoctor.restartServer", () =>
      active.restart(),
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(CONFIG_SECTION)) {
        void active.onConfigurationChanged();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(
      () => void startIfRelevant(),
    ),
  );

  await startIfRelevant();
}

export function deactivate(): Promise<void> | undefined {
  const active = controller;
  controller = undefined;
  return active?.dispose();
}

/**
 * Cheap activation gate so completely unrelated workspaces never spawn the
 * server: an i18n-doctor config file anywhere, or a root package.json that
 * depends on a known i18n library. Real project discovery stays in the
 * language server.
 */
async function workspaceLooksRelevant(): Promise<boolean> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) return false;

  const configs = await vscode.workspace.findFiles(
    CONFIG_GLOB,
    "**/node_modules/**",
    1,
  );
  if (configs.length > 0) return true;

  for (const folder of folders.slice(0, 20)) {
    const manifest = vscode.Uri.joinPath(folder.uri, "package.json");
    try {
      const bytes = await vscode.workspace.fs.readFile(manifest);
      const json: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
      if (packageJsonMentionsI18n(json)) return true;
    } catch {
      // Missing or malformed package.json — not relevant evidence.
    }
  }
  return false;
}
