# @i18n-doctor/issues

> Part of [i18n-doctor](https://github.com/taha-farzalizadeh/i18n-doctor) — static localization analysis for JavaScript and TypeScript.

Issue engine and multi-format reporters (terminal, JSON, SARIF, Markdown, HTML).

Issue types:

| Type | Default severity |
| --- | --- |
| `unused-key` | warning (info when softened by dynamic usage) |
| `missing-key` | error |
| `duplicate-key` | warning |
| `untranslated-text` | info |

This package is an internal engine module. Most users only need the CLI:

```bash
npx i18n-doctor check
```

## License

MIT
