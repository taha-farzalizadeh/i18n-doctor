# @i18n-doctor/language-server

Live i18n diagnostics in any LSP-compatible editor. The server is an adapter: it
translates i18n-doctor analysis into LSP diagnostics and does no analysis of its
own.

```
IDE → LSP → language-server → i18n-doctor analyzer → issues → diagnostics → underline
```

## Install

```bash
npm install --save-dev @i18n-doctor/language-server
```

## Run

```bash
i18n-doctor-language-server --stdio
```

| Flag | Meaning |
| --- | --- |
| `--stdio` | stdio transport (the default and only transport) |
| `--log-level <level>` | `silent` \| `error` \| `warn` \| `info` \| `debug` |
| `--debounce <ms>` | Analysis debounce window |
| `--version`, `--help` | Print and exit |

See [`examples/`](./examples) for a VS Code extension, a WebStorm plugin, and a
demo project.

## Public API

```ts
import { startLanguageServer, createLanguageServer } from "@i18n-doctor/language-server";

// stdio, listening immediately:
startLanguageServer();

// Or build it first and attach your own transport:
const server = createLanguageServer({ connection, logLevel: "debug" });
server.listen();
```

## Diagnostics

Every diagnostic has `source: "i18n-doctor"`, a range covering the key (never a
whole file or line), and one of these codes:

| Code | Severity | Reported on | Meaning |
| --- | --- | --- | --- |
| `missing-key` | error | the `t()` call | The key is used but not defined |
| `unused-key` | warning | the catalog entry | The key is defined but never used |
| `duplicate-key` | warning | the catalog entry | One key defined twice in a locale |
| `missing-translation` | warning | the base catalog entry | Another locale lacks the key |
| `extra-translation` | info | the catalog entry | A locale has a key the base locale lacks |
| `namespace-unresolved` | info | the `t()` call | The namespace could not be resolved |

The first three come from `@i18n-doctor/issues`, so their severities follow the
`rules` block of your config: `{"rules": {"unused-key": "off"}}` silences a code
in the editor exactly as it does on the command line. `data` carries
`{ code, key, namespace?, locale?, analyzerMessage?, confidence? }` for clients
that want to build their own UI.

`namespace-unresolved` only fires in projects that actually use namespaces, and
is suppressed where a `missing-key` diagnostic already covers the same span, so
one ambiguous call never produces two underlines.

Keys stay namespace-qualified: `home:SAVE`, `settings:SAVE`, and `profile:SAVE`
are three distinct keys, and a bare `t("SAVE")` resolves against the namespace
the surrounding `useTranslation()` established.

## Configuration

Configuration comes from the existing i18n-doctor config — there is no second
format. The `languageServer` block holds the editor-only options:

```json
{
  "languageServer": {
    "enabled": true,
    "debounce": 250,
    "logLevel": "error",
    "maxDiagnosticsPerFile": 500,
    "coverage": true
  }
}
```

| Option | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Publish diagnostics at all |
| `debounce` | `250` | Milliseconds of idle time before analyzing (0–60000) |
| `logLevel` | `error` | `silent` \| `error` \| `warn` \| `info` \| `debug` |
| `maxDiagnosticsPerFile` | `500` | Cap per document, keeping the earliest positions |
| `coverage` | `true` | Include cross-locale `missing-translation` findings |

Clients may also send the same block through `initializationOptions` or
`workspace/didChangeConfiguration`, nested under `languageServer`, `i18nDoctor`,
or `i18n-doctor`. Client-supplied settings win over the config file, and options
passed to `createLanguageServer` win over both.

## Behaviour

**Unsaved buffers are authoritative.** Open documents are served to the analyzer
through an overlay filesystem, so a fix stops being reported before you save,
and a key added to a catalog buffer immediately satisfies its usages.

**Responsiveness.** Edits are debounced, only the affected half of the pipeline
is re-run (editing a component reuses the translation catalog and vice versa),
one analysis runs at a time, and a run superseded by a newer edit is aborted and
discarded. Diagnostics are never published for a document version that has
already moved on.

**Ownership.** The server tracks exactly which documents it has published to,
clears any it no longer has findings for, and skips no-op republishes so typing
does not spam the client. Everything is released on `shutdown`.

**Error isolation.** A syntax error, invalid JSON, a catalog module that throws,
a missing project, or a malformed config is logged and skipped; the rest of the
project keeps producing diagnostics and the server stays up.

**Logging.** stdout belongs to the JSON-RPC transport and is never written to.
Logs go to `window/logMessage`, falling back to stderr when no client is
attached.

## Scope

This package publishes diagnostics only. Completion, hover, code actions, and
fixes are deliberately out of scope.
