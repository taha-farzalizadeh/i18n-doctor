# @i18n-doctor/eslint-plugin

ESLint plugin that surfaces **i18n-doctor** findings in the editor and CI using the
**same analyzer** as the CLI and language server.

No second parser, locale extractor, or project scanner lives in this package — rules
call the existing `@i18n-doctor/cli` pipeline once per ESLint run and map diagnostics
to `context.report()`.

## Install

```bash
npm install -D @i18n-doctor/eslint-plugin eslint
```

## Flat config (recommended)

```javascript
import i18nDoctor from "@i18n-doctor/eslint-plugin";

export default [
  i18nDoctor.configs.recommended,
];
```

Lint source and locale catalogs together:

```javascript
import i18nDoctor from "@i18n-doctor/eslint-plugin";
import json from "@eslint/json";
import tseslint from "typescript-eslint";

export default [
  ...i18nDoctor.configs.recommended,
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  ...json.configs.recommended,
];
```

## Manual rules

```javascript
rules: {
  "i18n-doctor/no-missing-key": "error",
  "i18n-doctor/no-unused-key": "warn",
  "i18n-doctor/no-untranslated": "warn",
  "i18n-doctor/no-duplicate-key": "error",
  "i18n-doctor/locale-consistency": "warn",
}
```

## Rules

| Rule | Default | Analyzer source |
| --- | --- | --- |
| `no-missing-key` | error | `missing-key` |
| `no-unused-key` | warn | `unused-key` |
| `no-untranslated` | warn | `untranslated-text` |
| `no-duplicate-key` | error | `duplicate-key` |
| `locale-consistency` | warn | `@i18n-doctor/coverage` |

Configuration, `ignoreKeys`, inline suppressions (`// i18n-doctor-ignore …`), and
namespace/locale behavior come from your existing **`i18n-doctor.config.*`** — there is
no separate ESLint-specific config format, and you do **not** need to duplicate
`ignoreKeys` in `eslint.config.js`. The config is resolved relative to the linted
project (the same loader the CLI and language server use), so glob patterns apply
identically everywhere.

## How it works

```
ESLint rule (per file)
  ↓
Shared analysis session (once per project / ESLint process)
  ↓
analyzeScope() — same pipeline as CLI + language server
  ↓
Filter diagnostics for the current file
  ↓
context.report({ loc, message })
```

Project-wide rules such as **unused keys** report on locale catalog files when those
files are included in your ESLint run. The analyzer is **not** re-executed for every
source file or rule.

## Supported files

- Source: `.js`, `.jsx`, `.ts`, `.tsx` (and anything the core analyzer already scans)
- Catalogs: JSON / JS / TS locale layouts discovered by `@i18n-doctor/sources`

## License

MIT
