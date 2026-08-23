# i18n-doctor for VS Code

> **Beta — v0.9.2**

Live i18n diagnostics in VS Code. This extension is an LSP client: it starts the
bundled [`@i18n-doctor/language-server`](../language-server) over stdio and lets
VS Code render the diagnostics the server publishes. It does not parse source,
extract keys, or decide what is unused.

```
VS Code → this extension → LanguageClient (stdio)
        → @i18n-doctor/language-server → analyzer → publishDiagnostics
        → underlines + Problems panel
```

## Install

Install **i18n-doctor** from the
[VS Code Marketplace](https://marketplace.visualstudio.com/vscode)
(Extensions view → search **i18n-doctor** → Install).

No project dependency and no global language-server install are required — the
server is bundled with the extension.

## What you get

| Situation | Result |
| --- | --- |
| `t("auth.nonexistent")` | Error underline exactly over `"auth.nonexistent"` |
| Unused catalog entry | Warning on the locale file |
| Key missing from another locale | Warning on the base catalog entry |
| Edit the source or the locale | Diagnostics update after the server's debounce |

Severities, ignore patterns, and analyzer behavior still come from the project's
`i18n-doctor` config. This extension only contributes editor-side overrides.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `i18nDoctor.enabled` | `true` | Start the language server at all |
| `i18nDoctor.languageServer.debounce` | *(unset)* | Override project debounce (ms) |
| `i18nDoctor.languageServer.logLevel` | *(unset)* | `silent` \| `error` \| `warn` \| `info` \| `debug` |
| `i18nDoctor.languageServer.maxDiagnosticsPerFile` | *(unset)* | Cap per document |
| `i18nDoctor.languageServer.coverage` | *(unset)* | Include cross-locale findings |
| `i18nDoctor.languageServer.path` | *(empty)* | Absolute path to an alternate server module (dev) |
| `i18nDoctor.trace.server` | `off` | Trace LSP traffic in the output channel |

Only values you explicitly set are forwarded to the server. Leaving a setting
at its package.json default keeps the project's own `languageServer` block in
control.

## Commands

- **i18n-doctor: Restart Language Server** — stops and restarts the bundled
  server (useful after a crash or when developing the server itself).

## Activation

The extension activates for JavaScript / TypeScript / JSON documents, or when
an `i18n-doctor.config.*` file is present. It only **starts** the language
server when the workspace looks i18n-relevant (a config file, or a root
`package.json` that depends on a known i18n library). Unrelated workspaces stay
quiet.

## Development

```bash
# From the monorepo root
npm install
npm run build -w @i18n-doctor/language-server
npm run build -w i18n-doctor-vscode
npm test -w i18n-doctor-vscode
```

Open this folder in VS Code and press F5 (or use the "Run Extension" launch
config under `examples/`) to start an Extension Development Host. Open
`examples/demo-project` in that host — `src/Login.tsx` should underline
`"nonexistent"` without installing anything into the demo.

### How the server is found

1. `i18nDoctor.languageServer.path` if set (must exist)
2. `dist/server.js` next to the extension (production / .vsix)
3. `@i18n-doctor/language-server/dist/bin.js` walked up from the extension root
   (monorepo Extension Development Host before/without a fresh bundle)

## Packaging (maintainers)

Bump `"version"` in `package.json` before each Marketplace publish, then:

```bash
npm run package -w i18n-doctor-vscode
```

Produces `dist/i18n-doctor.vsix`. The build step esbuilds:

- `dist/extension.js` — extension host code (`vscode` left external)
- `dist/server.js` — the entire language server and analyzer graph as one
  CommonJS file

So a published extension is self-contained.

### Extension icon

Marketplace icon: `media/icon.png` (**128×128 PNG**).

Referenced in `package.json` as `"icon": "media/icon.png"`.  
VS Code does **not** use SVG for the marketplace icon (unlike JetBrains
`META-INF/pluginIcon.svg`).

## Related

JetBrains / WebStorm plugin (same language server):
[`packages/jetbrains`](../jetbrains) —
[Marketplace listing](../jetbrains/MARKETPLACE.md),
[publishing](../jetbrains/PUBLISHING.md).

## Scope

Diagnostics only. Completion, hover, code actions, and auto-fix are out of
scope for this phase — they belong in later IDE work on top of the same
language server.
