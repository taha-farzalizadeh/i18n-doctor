# @i18n-doctor/cli

> **Beta — v0.9.2** · [GitHub](https://github.com/taha-farzalizadeh/i18n-doctor) · [Issues](https://github.com/taha-farzalizadeh/i18n-doctor/issues)

Static localization analysis for JavaScript and TypeScript projects.  
Finds **unused**, **missing**, and **duplicate** translation keys — without executing your code.

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
