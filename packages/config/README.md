# @i18n-doctor/config

> Part of [i18n-doctor](https://github.com/taha-farzalizadeh/i18n-doctor) — static localization analysis for JavaScript and TypeScript.

Configuration loading, ignore rules, and inline suppression engine.

## Config files

The loader discovers, validates, and normalizes the nearest config starting from an explicit root (never `process.cwd()`):

1. `i18n-doctor.config.ts`
2. `i18n-doctor.config.js`
3. `i18n-doctor.config.mjs`
4. `i18n-doctor.config.cjs`
5. `i18n-doctor.config.json`
6. an `"i18n-doctor"` field in `package.json`

TypeScript/JS configs are parsed statically — the file is **never executed**, so `export default defineConfig({ … })` works without a build step. Dynamic expressions are reported as diagnostics instead of being evaluated. Invalid configs produce `ConfigDiagnostic` entries with the file path and a description; they are never silently ignored.

## `defineConfig` / `loadConfig`

```ts
import { defineConfig, loadConfig } from "@i18n-doctor/config";

// Typed identity helper for config files (type checking + completions only)
export default defineConfig({
  ignoreKeys: ["SERVER_*", "BACKEND_*"],
});

// Find + load + validate + normalize for one project/workspace root
const result = await loadConfig({ cwd: projectRoot });
// → { cwd, configPath?, config: UserConfig, diagnostics }
```

`loadConfig` returns defaults when no config file exists (`ignoreKeys: []`, …) — absence of a config never breaks consumers. Pass `configPath` to skip discovery.

## `ignoreKeys`

Glob-style patterns (`*`, `?`, `**`) matched against the full translation key. Matching keys are **excluded from `unused-key` diagnostics only** — missing-key, duplicate-key, locale-consistency, and hardcoded-text detection remain active. The same matcher backs `ignoreFiles`, `ignoreLocales`, `ignoreNamespaces`, and `include`/`exclude`.

## Rules

| RuleId | Default |
| --- | --- |
| `unused-key` | `warning` |
| `missing-key` | `error` |
| `duplicate-key` | `warning` |
| `untranslated-text` | `info` |

```json
{
  "rules": {
    "untranslated-text": "warning",
    "unused-key": "off"
  }
}
```

Inline suppressions:

```ts
// i18n-doctor-ignore untranslated-text
<span>Hardcoded label</span>
```

This package is an internal engine module. Most users only need the CLI:

```bash
npx i18n-doctor check
```

## License

MIT
