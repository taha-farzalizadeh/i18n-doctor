# i18n-doctor for VS Code

> **Beta — v0.11.9**

Live i18n diagnostics, **Go to Translation**, **Hover**, and **Completion** in
VS Code. This extension is an LSP client: it starts the bundled
[`@i18n-doctor/language-server`](../language-server) over stdio and lets VS Code
render what the server publishes. It does not parse source, extract keys, or
decide what is unused.

## What's new in 0.11.9

- Path-alias imports (`app/*`, `@core/*`) for translator factories and configs
- Store/object methods with `t` params; nested `schema(t)` → `dateSchema(t)`
- Renamed Zustand selectors (`deleteRowRawById = useStore(s => s.deleteRawRowById)`)
- Multi-namespace `addResourceBundle` on one shared i18n module
- String-literal array maps, enum-typed `t(type as string)`, `labelKey` / config lookups
- **Unified versioning:** npm packages, language-server, and IDE plugins are all **0.11.9**
- Bundled language server @ 0.11.9

## What's new in 0.11.8

- Helper returns (`t(getTitleByStatusType(…))`), string maps (`t(descriptions[item])`),
  object configs (`t(config.title)`), route titles via `getRouteParam(..., "title")`
- `Object.keys(Enum).map((key) => t(key))` and `useTranslation(ref || "ns")` fallback
- **Unified versioning:** npm packages, language-server, and IDE plugins are all **0.11.8**
- Bundled language server @ 0.11.8

## What's new in 0.11.7

- Prop-passed nav/config keys via `t(item.translation)` (e.g. `navigationConfig`)
- Nested `children` arrays included
- Unified versioning at **0.11.7**

## What's new in 0.11.6

- Form-field maps (`t(field.label)`), column factories (`usersColumns(t)`), and
  string-enum state maps (`t(item.name)` / `WpNavbar.SENSITIVE_TERMS`) resolve
  as usages — same analyzer as CLI / ESLint / JetBrains
- Bundled language server @ 0.11.5

## What's new in 0.11.2

- **Static ternaries** — `t(cond ? "A" : "B")` and same-file
  `const k = cond ? "A" : "B"; t(k)` both count as usages
- Bundled language server @ 0.11.2

## What's new in 0.11.1

- Faster locale coverage warnings (locale edits skip debounce; early coverage publish)
- `ignoreKeys` still suppresses only unused — locale gaps stay reported

## What's new in 0.11.0 (Phase 20)

- **Go to Translation** — F12 / Cmd+Click on `t("home.title")` jumps to the catalog entry
- **Translation Hover** — shows key, locale values, namespace, and source location
- **Translation Completion** — suggests keys inside `t("...")` with translated detail
- Powered by a shared `@i18n-doctor/translation-index` (same catalog model as ESLint)

> **ESLint provides diagnostics.** Go to Translation, Hover, and Completion are
> provided by the i18n-doctor Language Server and consumed by this extension
> (and the JetBrains plugin).

```
VS Code → this extension → LanguageClient (stdio)
        → @i18n-doctor/language-server → analyzer + translation index
        → diagnostics / definition / hover / completion
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
| F12 / Cmd+Click on `t("auth.login")` | Opens `locales/en.json` on the `login` entry |
| Hover `auth.login` | Shows English / Persian values, namespace, source |
| Type inside `t("auth.")` | Completes `auth.login`, `auth.logout`, … |
| Unused catalog entry | Warning on the locale file |
| Key may be covered only by dynamic usage | Info: “may be unused” with related dynamic call site |
| Hardcoded JSX / UI attribute text | Info: `untranslated-text` |
| Key missing from another locale | Warning on the base catalog entry |
| Edit the source or the locale | Features update after the server's debounce |

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

### Changelog (recent)

- **0.11.9** — Path aliases, store/`t` methods, renamed Zustand selectors, multi-ns bundles, string-array maps, enum-typed props; unified version with npm/ESLint/LS
- **0.11.8** — Helpers, string maps, chart/route configs, `Object.keys(Enum)`, `useTranslation` fallback; unified version with npm/ESLint/LS
- **0.11.7** — Prop-passed `t(item.translation)` for navigation configs; unified version with npm/ESLint/LS
- **0.11.6** — Form maps, column factories, string-enum state maps (parity with CLI/ESLint)
- **0.11.2** — Static ternaries count as usages (`t(cond ? "A" : "B")`)
- **0.11.1** — Faster coverage warnings; `ignoreKeys` unused-only (locale gaps stay)
- **0.11.0** — Go to Translation, Hover, Completion (Phase 20)
- **0.10.2** — Bundled LS with unified config / `ignoreKeys`
- **0.9.4** — Bundled analyzer: prop-passed `t`, static key concat, soft unused for dynamic keys, `untranslated-text` (info)

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

Diagnostics, Go to Translation, Hover, and Completion come from the language
server. Code actions / auto-fix remain out of scope for this phase.
