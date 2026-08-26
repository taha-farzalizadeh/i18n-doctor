# i18n-doctor

> **Beta — v0.9.2**
> This is an early release. APIs may change, edge cases exist, and your feedback matters. See [Contributing](#contributing) to help shape the project.

Static localization analysis for JavaScript and TypeScript projects. Finds unused, missing, and duplicate translation keys — and hardcoded UI text that never goes through translation — without executing your code.

---

## What it does

- **Unused keys** — translation keys defined in your locale files but never referenced in source code
- **Missing keys** — keys used in code that have no matching translation
- **Duplicate keys** — keys defined more than once in the same namespace
- **Untranslated text** — likely user-facing JSX/UI strings that are not passed through `t()` / `formatMessage` (info by default)
- **Cross-locale coverage** — keys present in one locale but absent in others

Also understands common usage patterns that static tools often miss:

- Prop-passed translators (`function Child({ t }) { return t("key") }`)
- Static key composition (`t("HELLO_" + "AGAIN")`, same-file `const` keys)
- Soft unused hints when a key may still be covered by dynamic usage (`t("HELLO_" + suffix)`)

Analysis is purely static. No runtime, no bundler, no side effects.

---

## Requirements

- Node.js ≥ 18

---

## Installation

```bash
# npm
npm install -D @i18n-doctor/cli

# yarn
yarn add -D @i18n-doctor/cli

# pnpm
pnpm add -D @i18n-doctor/cli
```

---

## Quick start

Run from the root of your project:

```bash
npx i18n-doctor check
```

Or point it at a specific path:

```bash
npx i18n-doctor check ./apps/web
```

---

## CLI reference

```
Usage: i18n-doctor [options] [command]

Commands:
  check [options] [path]   Analyze a project for unused, missing, and duplicate keys

Options:
  -V, --version            Print CLI version
  -h, --help               Display help
```

### `check` options

| Flag | Description |
|---|---|
| `[path]` | Project root to analyze (default: current directory) |
| `-c, --config <path>` | Path to config file |
| `--json` | Output JSON report |
| `--sarif` | Output SARIF 2.1.0 report |
| `--markdown` | Output Markdown report |
| `--html` | Output HTML report |
| `--silent` | Suppress output (exit code only) |
| `--verbose` | Show timings and extra diagnostics |
| `--cwd <path>` | Working directory for path resolution |
| `--no-color` | Disable ANSI colors and hyperlinks |
| `--framework <id>` | Override framework/library detection |
| `--locale <locale>` | Restrict analysis to a single locale |
| `--namespace <ns>` | Restrict analysis to a single namespace |
| `--base-locale <locale>` | Base locale for cross-locale coverage |
| `--ignore-duplicates` | Skip duplicate key checks |
| `--no-coverage` | Skip locale consistency analysis |

### Exit codes

| Code | Meaning |
|---:|---|
| `0` | No failing issues |
| `1` | Issues found that fail the configured exit policy |
| `2` | Config, I/O, or permission error |

---

## Output formats

**Terminal (default)**

```
· Discovering project…
· Loading configuration…
· Detecting framework…
· Collecting translation sources…
· Detecting translation usages…
· Analyzing issues…
✓ Done (412ms)

i18n-doctor issues
Root: /Users/you/app

Summary
  Unused:       2
  Missing:      1
  Duplicate:    0
  Untranslated: 1
  Total:        4

! UNUSED KEY  auth.legacy.banner
  Defined  locales/en/auth.json:12:3

x MISSING KEY  home.cta
  Used  src/pages/Home.tsx:44:18
```

Paths are clickable OSC-8 hyperlinks in supported terminals.

**JSON** (`--json`)

```json
{
  "root": "/Users/you/app",
  "stats": { "total": 4, "unusedKey": 2, "missingKey": 1, "duplicateKey": 0, "untranslatedText": 1 },
  "issues": [
    {
      "type": "missing-key",
      "severity": "error",
      "key": "home.cta",
      "file": "src/pages/Home.tsx",
      "line": 44,
      "column": 18
    }
  ]
}
```

Also available: `--sarif` (SARIF 2.1.0), `--markdown`, `--html`.

---

## Configuration

Place an `i18n-doctor.config.json` (or `.js` / `.ts`) at your project root. The CLI will pick it up automatically, or you can point to it with `--config`.

```json
{
  "localesDir": "public/locales",
  "baseLocale": "en",
  "rules": {
    "unused-key": "error",
    "missing-key": "error",
    "duplicate-key": "warning",
    "untranslated-text": "info"
  },
  "ignore": [
    "legacy.*",
    "vendor.*"
  ]
}
```

| Rule | Default | Meaning |
| --- | --- | --- |
| `unused-key` | `warning` | Defined in locale files, never used in code |
| `missing-key` | `error` | Used in code, missing from locale files |
| `duplicate-key` | `warning` | Same key defined more than once |
| `untranslated-text` | `info` | Hardcoded UI text not passed through a translator |

Set any rule to `"off"` to disable it. Inline suppressions work too, e.g. `// i18n-doctor-ignore untranslated-text`.

---

## Monorepo support

Pass the path to any workspace package, or run from the monorepo root and let the CLI discover packages automatically:

```bash
npx i18n-doctor check ./packages/web
```

---

## Editor support

### VS Code

Install **i18n-doctor** from the
[VS Code Marketplace](https://marketplace.visualstudio.com/vscode)
(Extensions → search **i18n-doctor**). The extension ships a bundled language
server — no project dependency required.

See [`packages/vscode`](./packages/vscode).

### JetBrains (WebStorm)

Install **i18n-doctor** from the [JetBrains Marketplace](https://plugins.jetbrains.com)
(**Settings → Plugins → Marketplace**). Requires Node.js ≥ 18
(**Settings → Languages & Frameworks → JavaScript Runtime**). No project
dependency needed.

See [`packages/jetbrains`](./packages/jetbrains). Maintainers: publishing guide
in [`PUBLISHING.md`](./packages/jetbrains/PUBLISHING.md).

### Language server (any LSP client)

```bash
npm install --save-dev @i18n-doctor/language-server
i18n-doctor-language-server --stdio
```

Editor-only options live under `languageServer` in the same config file:

```json
{
  "languageServer": {
    "debounce": 250,
    "logLevel": "error"
  }
}
```

See [`packages/language-server`](./packages/language-server) for the full option
list and custom client notes.

---

## Packages

This repo is a monorepo. Each package is independently publishable.

| Package | Description |
|---|---|
| `@i18n-doctor/cli` | CLI entry point and orchestration |
| `@i18n-doctor/language-server` | LSP server exposing the analysis as live editor diagnostics |
| `i18n-doctor-vscode` | VS Code extension (LSP client; ships the bundled server) |
| `i18n-doctor-jetbrains` | JetBrains / WebStorm plugin (LSP client; ships the bundled server) |
| `@i18n-doctor/ast` | TypeScript Compiler API — parse JS/JSX/TS/TSX, traversal and query helpers |
| `@i18n-doctor/callgraph` | Call graph construction and translation wrapper detection |
| `@i18n-doctor/config` | Config loading, ignore rules, inline suppression |
| `@i18n-doctor/detect` | Framework, package manager, language, and i18n library detection |
| `@i18n-doctor/sources` | Translation source discovery and key catalog extraction |
| `@i18n-doctor/usages` | Translation key usage detection with source locations |
| `@i18n-doctor/issues` | Issue engine and reporters |
| `@i18n-doctor/coverage` | Cross-locale coverage analysis |
| `@i18n-doctor/scanner` | File system scanning utilities |
| `@i18n-doctor/imports` | Import resolution helpers |
| `@i18n-doctor/resolve` | Key and path resolution |
| `@i18n-doctor/templates` | Template literal and dynamic key analysis |
| `@i18n-doctor/context` | Shared execution context |
| `@i18n-doctor/constants` | Shared constants |
| `@i18n-doctor/dataflow` | Dataflow analysis utilities |

---

## Contributing

**i18n-doctor is in beta and actively needs help.** Here's how you can contribute:

- **Find bugs** — run it on your project and open an issue with repro steps
- **Add features** — pick up an open issue or propose something new
- **Improve docs** — if something is unclear, a PR fixing it is very welcome
- **Test edge cases** — unusual i18n setups, nested namespaces, dynamic keys, custom wrappers

### Workflow

1. Fork the repo and create a branch
2. Make your changes (all packages are in `packages/`)
3. Build and test:
   ```bash
   npm run build
   npm run test
   ```
4. Open a merge request — describe what you changed and why
5. A maintainer will review and merge

There's no bureaucracy here. If it improves the project, it'll land.

### Development setup

```bash
git clone https://github.com/your-org/i18n-doctor
cd i18n-doctor
npm install
npm run build
```

Requires Node.js ≥ 18.

---

## Beta status

v0.9.2 is a beta release. That means:

- Core analysis works and is usable on real projects
- Prop-passed `t`, static key concat, soft dynamic-unused hints, and untranslated UI text are supported
- Some edge cases remain (fully opaque dynamic keys, complex cross-file wrappers, custom i18n libraries)
- The config schema may have breaking changes before v1.0
- `--fix` is reserved but not yet implemented

If something doesn't work on your project, please open an issue. That's exactly the kind of feedback that moves this to stable.

---

## Changelog (recent)

### Analyzer / IDE (2026-08)

- **Untranslated text** — flag hardcoded JSX/UI strings not passed through translators (`untranslated-text`, default `info`)
- **Prop-passed `t`** — detect usages when `t` is received via props
- **Static key composition** — resolve `t("a" + "b")`, static templates, same-file `const` keys
- **Dynamic unused softening** — when `t("HELLO_" + suffix)` exists, matching catalog keys get an info “may be unused” hint instead of a hard unused warning
- **JetBrains 0.9.5** / **VS Code 0.9.4** — rebundled language server with the above

---

## License

MIT
