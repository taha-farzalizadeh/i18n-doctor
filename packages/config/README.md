# @i18n-doctor/config

> Part of [i18n-doctor](https://github.com/taha-farzalizadeh/i18n-doctor) — static localization analysis for JavaScript and TypeScript.

Configuration loading, ignore rules, and inline suppression engine.

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
