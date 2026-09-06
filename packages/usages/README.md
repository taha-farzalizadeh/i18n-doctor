# @i18n-doctor/usages

> **Beta — v0.11.7** · Part of [i18n-doctor](https://github.com/taha-farzalizadeh/i18n-doctor) — static localization analysis for JavaScript and TypeScript.

Translation key **usage** detection across React, Vue, Angular, and more — plus
helpers used by the issue engine:

- Prop-passed translators (`{ t }` / `props.t`)
- Static key composition (`"a" + "b"`, static templates, same-file `const`)
- Static ternaries (`t(cond ? "A" : "B")`, `const k = cond ? "A" : "B"; t(k)`)
- Form-field maps (`t(field.label)` from static config arrays)
- Translator factories (`usersColumns(t)` inherits call-site namespace)
- String enums + `useState` maps (`t(item.name)` / `WpNavbar.SENSITIVE_TERMS`)
- Prop-passed config objects (`t(item.translation)` for navigation configs)
- Dynamic key fragments (for soft unused hints)
- Untranslated UI literals (JSX text / common attributes)

This package is an internal engine module. Most users only need the CLI:

```bash
npx i18n-doctor check
```

## License

MIT
