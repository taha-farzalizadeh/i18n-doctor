# @i18n-doctor/cli

> **Beta — v0.10.2** · [GitHub](https://github.com/taha-farzalizadeh/i18n-doctor) · [Issues](https://github.com/taha-farzalizadeh/i18n-doctor/issues)

Static localization analysis for JavaScript and TypeScript projects.  
Finds **unused**, **missing**, **duplicate** translation keys, and **untranslated** hardcoded UI text — without executing your code.

## Install & run

```bash
# Run without installing
npx i18n-doctor check

# Install globally
npm install -g @i18n-doctor/cli
i18n-doctor check
```

## Usage

```
i18n-doctor check [path] [options]

Options:
  --dir <path>    Analyze only files under this directory (relative to project root)
  --json          JSON report
  --sarif         SARIF 2.1.0 report
  --markdown      Markdown report
  --html          HTML report
  --silent        Exit code only, no output
  --verbose       Show timings
  --config        Path to config file
  --locale        Restrict to one locale
  --namespace     Restrict to one namespace
  --base-locale   Base locale for cross-locale coverage
  --no-coverage   Skip locale consistency analysis
```

### Check one folder

Pass a subdirectory as `[path]`, or use `--dir` from the project root:

```bash
# Only report issues in src/features/auth (still loads locale catalogs project-wide)
i18n-doctor check src/features/auth

i18n-doctor check --dir src/features/auth
```

Missing-key and untranslated findings are limited to code under that folder.
Locale files outside the folder are still read so missing-key checks stay accurate.
Unused-key and duplicate-key findings only appear when the catalog file is inside
the scoped directory.

## Rules

Configure in `i18n-doctor.config.json`:

| Rule | Default | Meaning |
| --- | --- | --- |
| `unused-key` | `warning` | Locale key never referenced in code |
| `missing-key` | `error` | Code uses a key missing from locale files |
| `duplicate-key` | `warning` | Key defined more than once |
| `untranslated-text` | `info` | Hardcoded UI text not passed through `t()` / similar |

Example:

```json
{
  "rules": {
    "untranslated-text": "warning",
    "unused-key": "error"
  }
}
```

## Exit codes

| Code | Meaning |
|---:|---|
| 0 | No failing issues |
| 1 | Issues found that fail the exit policy |
| 2 | Config, I/O, or permission error |

## Contributing

This is a beta release. Bug reports, feature requests, and pull requests are very welcome.  
See the [GitHub repo](https://github.com/taha-farzalizadeh/i18n-doctor) to get started.

## License

MIT
