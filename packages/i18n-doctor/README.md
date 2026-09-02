# i18n-doctor

> **Beta — v0.10.2**

Static localization analysis for JavaScript and TypeScript projects.  
Finds **unused**, **missing**, and **duplicate** translation keys — without executing your code.

Works with **React**, **Vue**, **Angular**, **Next.js**, **Nuxt**, **i18next**, **react-intl**, **vue-i18n**, **next-intl**, **Lingui**, and more.

---

## Quick start

No install needed:

```bash
npx i18n-doctor check
```

Or install globally:

```bash
npm install -g i18n-doctor
i18n-doctor check
```

Or as a dev dependency:

```bash
npm install -D i18n-doctor
```

Then add to `package.json`:

```json
"scripts": {
  "i18n:check": "i18n-doctor check"
}
```

---

## What it detects

- **Unused keys** — defined in locale files but never used in code
- **Missing keys** — used in code but not defined in any locale file
- **Duplicate keys** — defined more than once in the same namespace
- **Cross-locale gaps** — keys present in one locale but absent in others
- **Soft unused** — unused keys that may still match a dynamic usage (info)
- **Untranslated text** — hardcoded JSX / UI attribute strings not passed through a translator (info)

Prop-passed `t` (e.g. `{ t }` / `props.t`) and statically concatenated keys are counted as usages.

---

## Usage

```
i18n-doctor check [path] [options]
```

| Option | Description |
|---|---|
| `[path]` | Project root (default: current directory) |
| `--json` | JSON report |
| `--sarif` | SARIF 2.1.0 report |
| `--markdown` | Markdown report |
| `--html` | HTML report |
| `--silent` | Exit code only, no output |
| `--verbose` | Show timings and diagnostics |
| `-c, --config <path>` | Path to config file |
| `--locale <locale>` | Restrict to one locale |
| `--namespace <ns>` | Restrict to one namespace |
| `--base-locale <locale>` | Base locale for cross-locale coverage |
| `--no-coverage` | Skip locale consistency analysis |
| `--no-color` | Disable colors |

## Exit codes

| Code | Meaning |
|---:|---|
| `0` | No failing issues |
| `1` | Issues found that fail the exit policy |
| `2` | Config, I/O, or permission error |

---

## Configuration

Put an `i18n-doctor.config.json` (or `.js` / `.ts` / …) at your project root.
**You do not need to install the `i18n-doctor` package** just to write a config —
JSON and plain object exports work with only the ESLint plugin or IDE extension.

### JSON (recommended for plugin / extension-only users)

```json
{
  "ignoreKeys": ["SERVER_*", "BACKEND_*"]
}
```

### JavaScript (no imports)

```js
// i18n-doctor.config.js
export default {
  ignoreKeys: ["SERVER_*", "BACKEND_*"],
};
```

### TypeScript (optional typing)

If you already use the ESLint plugin:

```ts
import { defineConfig } from "@i18n-doctor/eslint-plugin";

export default defineConfig({
  ignoreKeys: ["SERVER_*", "BACKEND_*"],
});
```

Or with the CLI package:

```ts
import { defineConfig } from "i18n-doctor";

export default defineConfig({
  ignoreKeys: ["SERVER_*", "BACKEND_*"],
});
```

- `defineConfig` is a typed identity helper — autocompletion and type checking, no runtime behavior. Config files are **parsed statically and never executed**, so even `import { defineConfig } from "…"` works without that package being installed at runtime.
- `ignoreKeys` takes glob patterns (`*`, `?`, `**`) for keys that static analysis cannot reliably detect as used — backend-provided keys (`t(apiResponse.messageKey)`), dynamically generated keys, runtime catalogs. Patterns also match leaf segments (`SERVER_*` matches `common:SERVER_USER` and `errors.SERVER_USER`).
- **`ignoreKeys` only suppresses `unused-key`** — missing-key, duplicate-key, locale-consistency, and hardcoded-text detection stay fully active.
- The same config is picked up automatically by the **CLI**, the **ESLint plugin**, and **IDE integrations** (VS Code / JetBrains / LSP).

The nearest config is resolved from the project root in this order: `i18n-doctor.config.ts` → `.js` → `.mjs` → `.cjs` → `.json` → `"i18n-doctor"` field in `package.json`. An explicit `--config <path>` overrides discovery. No config file is required — defaults apply (`ignoreKeys: []`).

### ESLint rule severity

ESLint severity comes from **`eslint.config.js`**, not from `i18n-doctor.config.*`.
Override after spreading the recommended preset:

```js
export default tseslint.config(
  ...i18nDoctor.configs.recommended,
  {
    rules: {
      "i18n-doctor/no-missing-key": "warn",
      "i18n-doctor/no-unused-key": "warn",
    },
  },
  // unused / duplicate / locale-consistency on catalogs live under **/*.json —
  // override that block separately if needed:
  {
    files: ["**/*.json"],
    rules: {
      "i18n-doctor/no-unused-key": "off",
    },
  },
);
```

Analyzer `rules` in `i18n-doctor.config.*` control CLI / IDE severity and can turn rules `off`, but they do **not** change ESLint's error vs warn display.

---

## Programmatic API

```ts
import { defineConfig, loadConfig } from "i18n-doctor";

// Type-safe config object (for building config files or tooling)
const config = defineConfig({ ignoreKeys: ["SERVER_*"] });

// Find, load, validate, and normalize the config for a project root
const result = await loadConfig({ cwd: "/path/to/project" });
// → { cwd, configPath?, config: { ignoreKeys: [], ... }, diagnostics: [] }
```

`loadConfig` requires an explicit `cwd` — it never assumes `process.cwd()` — and returns defaults when no config file exists.

---

## ESLint plugin

Use the same analyzer in your editor and CI via ESLint — no separate config file.

### Install

```bash
npm install -D @i18n-doctor/eslint-plugin eslint
```

For TypeScript / TSX projects, also install `typescript-eslint`:

```bash
npm install -D typescript-eslint
```

### Flat config (`eslint.config.js`)

**Minimal:**

```javascript
import i18nDoctor from "@i18n-doctor/eslint-plugin";

export default [
  ...i18nDoctor.configs.recommended,
];
```

**React + TypeScript + JSON locale files (typical setup):**

```javascript
import i18nDoctor from "@i18n-doctor/eslint-plugin";
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
];
```

`configs.recommended` enables all five rules on source files and adds a second block for `**/*.json` locale catalogs (unused keys, duplicates, locale consistency).

### Run

```bash
npx eslint "src/**/*.{js,jsx,ts,tsx}" "locales/**/*.json"
```

Or `npx eslint .` if your project already lints those paths.

Unused-key and locale-consistency findings on catalog files only appear when locale JSON is included in the ESLint run.

### Rules

| Rule | Default severity | What it checks |
| --- | --- | --- |
| `i18n-doctor/no-missing-key` | error | Translation key used in code but missing from catalogs |
| `i18n-doctor/no-unused-key` | warn | Catalog key never referenced in code |
| `i18n-doctor/no-untranslated` | warn | Hardcoded UI text not passed through `t()` |
| `i18n-doctor/no-duplicate-key` | error | Same key defined twice in one namespace |
| `i18n-doctor/locale-consistency` | warn | Key missing in one locale but present in another |

Override severities in `eslint.config.js`:

```javascript
export default [
  ...i18nDoctor.configs.recommended,
  {
    rules: {
      "i18n-doctor/no-missing-key": "error",
      "i18n-doctor/no-unused-key": "warn",
      "i18n-doctor/no-untranslated": "warn",
      "i18n-doctor/no-duplicate-key": "error",
      "i18n-doctor/locale-consistency": "warn",
    },
  },
];
```

Your root **`i18n-doctor.config.*`** is used automatically — `ignoreKeys`, namespaces, and inline `// i18n-doctor-ignore` comments behave the same as in the CLI and IDE. You do not need a second ESLint-specific config format.

Package: [@i18n-doctor/eslint-plugin](https://www.npmjs.com/package/@i18n-doctor/eslint-plugin)

---

## Beta

This is v0.10.2 — a beta release. Core analysis works on real projects but edge cases exist.
Prop-passed `t`, static key concat, soft dynamic-unused hints, and untranslated UI text are supported.
Bug reports and contributions are very welcome.

- [GitHub](https://github.com/taha-farzalizadeh/i18n-doctor)
- [Issues](https://github.com/taha-farzalizadeh/i18n-doctor/issues)

---

## License

MIT
