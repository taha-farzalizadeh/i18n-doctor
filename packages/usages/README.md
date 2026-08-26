# @i18n-doctor/usages

> Part of [i18n-doctor](https://github.com/taha-farzalizadeh/i18n-doctor) — static localization analysis for JavaScript and TypeScript.

Translation key **usage** detection across React, Vue, Angular, and more — plus
helpers used by the issue engine:

- Prop-passed translators (`{ t }` / `props.t`)
- Static key composition (`"a" + "b"`, static templates, same-file `const`)
- Dynamic key fragments (for soft unused hints)
- Untranslated UI literals (JSX text / common attributes)

This package is an internal engine module. Most users only need the CLI:

```bash
npx i18n-doctor check
```

## License

MIT
