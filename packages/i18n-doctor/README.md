# i18n-doctor

> **Beta — v0.9.3**

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

Add an `i18n-doctor.config.json` at your project root:

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
    "legacy.*"
  ]
}
```

---

## Beta

This is v0.9.3 — a beta release. Core analysis works on real projects but edge cases exist.
Prop-passed `t`, static key concat, soft dynamic-unused hints, and untranslated UI text are supported.
Bug reports and contributions are very welcome.

- [GitHub](https://github.com/taha-farzalizadeh/i18n-doctor)
- [Issues](https://github.com/taha-farzalizadeh/i18n-doctor/issues)

---

## License

MIT
