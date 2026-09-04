# i18n-doctor for JetBrains (WebStorm)

> **Beta — v0.11.0**

Live i18n diagnostics, **Go to Translation**, **Hover**, and **Completion** in
WebStorm and other JetBrains IDEs that ship the platform LSP API. This plugin is
a **thin LSP client**: it starts the bundled
[`@i18n-doctor/language-server`](../language-server) over stdio and lets the IDE
render LSP results. It does **not** parse source, extract keys, or decide what
is unused.

## What's new in 0.11.0 (Phase 20)

- **Go to Translation** — navigate from `t("home.title")` to the catalog entry
- **Hover** — locale values, namespace, and source location
- **Completion** — key suggestions inside supported translation calls
- Shared `@i18n-doctor/translation-index` (same catalogs / matching as ESLint)

> **ESLint provides diagnostics.** Go to Translation, Hover, and Completion are
> provided by the i18n-doctor Language Server and consumed by this plugin (and
> the VS Code extension).

## Earlier fixes (0.10.3 / 0.10.2 / 0.10.1)

- **Marketplace Trial widget** — language server starts only in i18n-relevant
  projects, and missing Node/server no longer throws during automatic start
  (0.10.3).
- **Settings apply immediately** — changing log level, debounce, coverage, or
  Node/server path and clicking Apply restarts the language server so the new
  values take effect (0.10.0 only read them at cold start).
- **`ignoreKeys` leaf / namespace matching** — `SERVER_*` also suppresses
  `common:SERVER_USER` and `errors.SERVER_TIMEOUT`, not only exact `SERVER_USER`.
- **Config without installing `i18n-doctor`** — IDE-only users can use
  `i18n-doctor.config.json` or a plain `export default { ignoreKeys: […] }` in
  `.js` / `.ts`. No `defineConfig` import required.

```
WebStorm → this plugin → LSP (stdio)
         → @i18n-doctor/language-server → analyzer + translation index
         → diagnostics / definition / hover / completion
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

## What you get

| Situation | Result |
| --- | --- |
| `t("auth.nonexistent")` | Error underline exactly over `"auth.nonexistent"` |
| Go to Declaration / Cmd+Click on `t("auth.login")` | Opens the catalog entry (preferred locale) |
| Hover `auth.login` | Locale values, namespace, source path |
| Type inside `t("auth.")` | Completes catalog keys with translated detail |
| Unused catalog entry | Warning on the property key in every locale file that defines it |
| Key may be covered only by dynamic usage | Info: “may be unused” with related dynamic call site |
| Hardcoded JSX / UI attribute text | Info: `untranslated-text` (“This text has no translation”) |
| Key missing from another locale | Coverage warning on the base catalog entry |
| Edit source or locale (including unsaved buffers) | Features update after the server's debounce |

Severities and analyzer rules come from the project's `i18n-doctor` config. This
plugin only contributes process / IDE overrides.

## Settings

**Settings → Languages & Frameworks → i18n-doctor**

| Setting | Meaning |
| --- | --- |
| Enable | Start the language server at all |
| Node.js path | Absolute `node` binary (optional; otherwise JavaScript Runtime / PATH) |
| Server module path | Dev override for an alternate `server.js` / `bin.js` |
| Debounce / log level / max diagnostics / coverage | Forwarded only when set; empty keeps project config. **Apply restarts the server** so changes take effect. |

## Project config (no CLI install needed)

Put `i18n-doctor.config.json` at the project root:

```json
{
  "ignoreKeys": ["SERVER_*", "BACKEND_*"]
}
```

`ignoreKeys` only suppresses **unused-key** diagnostics. JSON / plain JS object
configs need no `import` and no `i18n-doctor` npm package.

## Commands

- **Tools → Restart Language Server** — restarts the i18n-doctor LSP process
  (also runs automatically when you Apply i18n-doctor settings)

## Activation

The server starts when you open a supported file (JS/TS/JSON/YAML/Vue/Svelte/HTML)
in an i18n-relevant project while the plugin is enabled. Project discovery stays
inside the language server.

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

Current release version is **`0.11.0`** — bump it before every Marketplace
upload (see [PUBLISHING.md](./PUBLISHING.md)). Listing copy:
[MARKETPLACE.md](./MARKETPLACE.md).

Architecture:

```
JetBrains Plugin  →  LSP  →  i18n-doctor Language Server  →  existing analyzer
```
