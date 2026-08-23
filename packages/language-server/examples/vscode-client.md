# VS Code client

The server is a plain stdio LSP process, so a VS Code extension only needs
`vscode-languageclient`. Nothing about the extension is i18n-doctor specific.

```ts
import { workspace, type ExtensionContext } from "vscode";
import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

export async function activate(context: ExtensionContext): Promise<void> {
  const serverOptions: ServerOptions = {
    run: {
      module: context.asAbsolutePath("node_modules/@i18n-doctor/language-server/dist/bin.js"),
      transport: TransportKind.stdio,
    },
    debug: {
      module: context.asAbsolutePath("node_modules/@i18n-doctor/language-server/dist/bin.js"),
      transport: TransportKind.stdio,
      args: ["--log-level", "debug"],
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "javascript" },
      { scheme: "file", language: "javascriptreact" },
      { scheme: "file", language: "typescript" },
      { scheme: "file", language: "typescriptreact" },
      { scheme: "file", language: "json" },
      { scheme: "file", language: "jsonc" },
      { scheme: "file", language: "yaml" },
    ],
    // The server registers its own watchers when the client supports dynamic
    // registration, so no synchronize.fileEvents block is required.
    initializationOptions: {
      languageServer: { debounce: 250, logLevel: "error" },
    },
  };

  client = new LanguageClient(
    "i18nDoctor",
    "i18n-doctor",
    serverOptions,
    clientOptions,
  );
  await client.start();
}

export async function deactivate(): Promise<void> {
  await client?.stop();
}
```

## Notes

- The document selector only controls which buffers VS Code synchronizes. Files
  that are never opened are still analyzed from disk.
- `initializationOptions` is optional. Without it the server reads
  `languageServer` from the project's i18n-doctor config.
- Diagnostics carry `source: "i18n-doctor"` and a `code` such as `missing-key`,
  which is what `workspace.getConfiguration` based filtering keys off.
