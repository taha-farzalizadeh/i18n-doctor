# i18n-doctor for JetBrains (WebStorm)

> **Beta — v0.10.0**

Live i18n diagnostics in WebStorm and other JetBrains IDEs that ship the
platform LSP API. This plugin is a **thin LSP client**: it starts the bundled
[`@i18n-doctor/language-server`](../language-server) over stdio and lets the IDE
render `publishDiagnostics`. It does **not** parse source, extract keys, or
decide what is unused.

```
WebStorm → this plugin → LSP (stdio)
         → @i18n-doctor/language-server → analyzer → publishDiagnostics
         → editor underlines + Problems tool window
```

## Requirements

- A JetBrains IDE with the LSP API (**WebStorm**, IntelliJ IDEA Ultimate, PhpStorm, …), **2024.3+**
- **Node.js ≥ 18** configured in the IDE (recommended) or on your `PATH`

No `@i18n-doctor/*` dependency is required in your project — the language server
is bundled with the plugin.

## Install

1. Open **Settings → Plugins → Marketplace**
2. Search for **i18n-doctor**
3. **Install** → restart the IDE

After install:

1. **Settings → Languages & Frameworks → JavaScript Runtime** → Node.js **≥ 18**
2. Open a supported file (`.tsx`, `.ts`, `.json`, …)
3. Confirm **Language Services** (status bar) shows **i18n-doctor** as running

## What you get

| Situation | Result |
| --- | --- |
| `t("auth.nonexistent")` | Error underline exactly over `"auth.nonexistent"` |
| Unused catalog entry | Warning on the property key in every locale file that defines it |
| Key may be covered only by dynamic usage | Info: “may be unused” with related dynamic call site |
| Hardcoded JSX / UI attribute text | Info: `untranslated-text` (“This text has no translation”) |
| Key missing from another locale | Coverage warning on the base catalog entry |
| Edit source or locale (including unsaved buffers) | Diagnostics update after the server's debounce |

Severities and analyzer rules come from the project's `i18n-doctor` config. This
plugin only contributes process / IDE overrides.

## Settings

**Settings → Languages & Frameworks → i18n-doctor**

| Setting | Meaning |
| --- | --- |
| Enable | Start the language server at all |
| Node.js path | Absolute `node` binary (optional; otherwise JavaScript Runtime / PATH) |
| Server module path | Dev override for an alternate `server.js` / `bin.js` |
| Debounce / log level / max diagnostics / coverage | Forwarded only when set; empty keeps project config |

## Commands

- **Tools → Restart Language Server** — restarts the i18n-doctor LSP process

## Activation

The server starts when you open a supported file (JS/TS/JSON/YAML/Vue/Svelte/HTML)
while the plugin is enabled. Project discovery stays inside the language server.

## Troubleshooting (no underlines)

1. **Language Services** widget: `i18n-doctor` must be **running**
2. Set **JavaScript Runtime** to Node 18+ (or an explicit Node path under i18n-doctor)
3. **Settings → i18n-doctor → Enable** must be checked
4. Open a supported file — the server starts on first open
5. **Tools → Restart Language Server** after changing Node / server path
6. Debug: `#com.intellij.platform.lsp` and `#com.i18ndoctor.jetbrains` under
   **Help → Diagnostic Tools → Debug Log Settings**

## Known limitations

- Requires a commercial JetBrains IDE with LSP (not IntelliJ IDEA Community / Android Studio)
- Requires Node.js ≥ 18 (not bundled inside the plugin)

---

## Development (contributors)

```bash
npm install
npm run runIde -w i18n-doctor-jetbrains   # sandboxed WebStorm + demo project
npm test -w i18n-doctor-jetbrains
```

Current release version is **`0.10.0`** — bump it before every Marketplace
upload (next would be `0.10.1`; see [PUBLISHING.md](./PUBLISHING.md)). Listing
copy: [MARKETPLACE.md](./MARKETPLACE.md).

Architecture:

```
JetBrains Plugin  →  LSP  →  i18n-doctor Language Server  →  existing analyzer
```
