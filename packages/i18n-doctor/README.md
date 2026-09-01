# i18n-doctor

> **Beta — v0.10.0**

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

Put an `i18n-doctor.config.ts` (or `.js` / `.mjs` / `.cjs` / `.json`) at your project root:

```ts
import { defineConfig } from "i18n-doctor";

export default defineConfig({
  ignoreKeys: [
    "SERVER_*",
    "BACKEND_*",
  ],
});
```

- `defineConfig` is a typed identity helper — autocompletion and type checking, no runtime behavior.
- TypeScript configs are parsed statically and never executed, so they work directly with `npx i18n-doctor check` (no build step).
- `ignoreKeys` takes glob patterns (`*`, `?`, `**`) for keys that static analysis cannot reliably detect as used — backend-provided keys (`t(apiResponse.messageKey)`), dynamically generated keys, runtime catalogs.
- **`ignoreKeys` only suppresses `unused-key`** — missing-key, duplicate-key, locale-consistency, and hardcoded-text detection stay fully active.
- The same config is picked up automatically by the **CLI**, the **ESLint plugin**, and **IDE integrations** (VS Code / JetBrains / LSP).

The nearest config is resolved from the project root in this order: `i18n-doctor.config.ts` → `.js` → `.mjs` → `.cjs` → `.json` → `"i18n-doctor"` field in `package.json`. An explicit `--config <path>` overrides discovery. No config file is required — defaults apply (`ignoreKeys: []`).

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

## Beta

This is v0.10.0 — a beta release. Core analysis works on real projects but edge cases exist.
Prop-passed `t`, static key concat, soft dynamic-unused hints, and untranslated UI text are supported.
Bug reports and contributions are very welcome.

- [GitHub](https://github.com/taha-farzalizadeh/i18n-doctor)
- [Issues](https://github.com/taha-farzalizadeh/i18n-doctor/issues)

---

## License

MIT
