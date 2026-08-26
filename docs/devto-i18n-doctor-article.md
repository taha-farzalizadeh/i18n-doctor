# i18n-doctor: Find Unused, Missing, and Hardcoded Translation Keys in JS/TS

<!--
Dev.to publish notes (delete this comment block before pasting into Dev.to if you want a clean post):

Title: i18n-doctor: Find Unused, Missing, and Hardcoded Translation Keys in JS/TS
Tags: javascript, typescript, i18n, devtools, opensource

Cover image (1000x420):
- Product name "i18n-doctor"
- Subtitle: "Static i18n analysis for JS/TS"
- Chips: unused · missing · untranslated
- Upload as Dev.to Cover image only

Inline images (optional):
1) Terminal screenshot of `npx i18n-doctor check` → place after "Try it in 10 seconds"
2) VS Code or WebStorm underline + Problems panel → place after the marketplace list
3) Diagram CLI / VS Code / JetBrains → Language Server → Analyzer → place under "Why I built it"
Alt text examples:
- "i18n-doctor CLI reporting unused and missing translation keys"
- "i18n-doctor VS Code extension underlining a missing translation key"
-->

Internationalization (i18n) breaks quietly. Keys rot in locale files. Screens ship with English hardcoded in JSX. Another locale is missing half the catalog. Most teams only notice this in production — or never.

**i18n-doctor** is an open-source static analyzer for JavaScript and TypeScript that finds those problems without running your app.

> One-line definition: i18n-doctor checks your source and locale files for unused keys, missing keys, duplicates, cross-locale gaps, and untranslated UI text — then reports them in the CLI or live in your editor.

## The problem i18n-doctor solves

Modern frontends rarely call `t("key")` in one simple place. Keys are:

- passed down as props (`{ t }`, `props.t`)
- built from static pieces (`"HELLO_" + "AGAIN"`)
- partly dynamic (`t("HELLO_" + suffix)`)
- mixed across React, Vue, Angular, Next.js, i18next, react-intl, vue-i18n, next-intl, Lingui, and more

Regex scripts and “search the repo” workflows miss those patterns. Manual review does not scale. Locale files grow, CI stays green, and translation debt compounds.

## Why I built it

I kept hitting the same gap: great i18n *libraries*, but weak *hygiene tooling* that understands real usage — including IDE feedback while you type, not only a CI script after the fact.

So I built **i18n-doctor** as:

1. a **CLI** you can run with `npx` or in CI
2. a shared **language server**
3. thin **VS Code** and **JetBrains / WebStorm** plugins on top of that server

Same analyzer everywhere — terminal, PR checks, and the editor.

<!-- IMAGE 3 (optional): diagram — CLI / VS Code / JetBrains → Language Server → Analyzer -->

## What it detects today

| Finding | Meaning |
| --- | --- |
| Unused keys | Defined in locales, never referenced in code |
| Missing keys | Used in code, missing from locales |
| Duplicate keys | Same key defined more than once |
| Cross-locale gaps | Present in one locale, absent in another |
| Untranslated text | Hardcoded JSX / UI strings that never go through a translator (info by default) |

It also handles harder static cases:

- prop-passed translators
- statically concatenated keys
- soft “may be unused” hints when a dynamic usage might still cover a key

Analysis is **static only** — no runtime, no bundler, no side effects.

## Try it in 10 seconds

```bash
npx i18n-doctor check
```

Or install as a dev dependency and wire a script:

```bash
npm install -D i18n-doctor
# package.json → "i18n:check": "i18n-doctor check"
```

<!-- IMAGE 1 (optional): terminal screenshot of i18n-doctor check output -->

Prefer live underlines while editing? Install the editor extension (bundled language server — no project dependency required):

- VS Code Marketplace → search **i18n-doctor**
- JetBrains Marketplace → search **i18n-doctor**

<!-- IMAGE 2 (optional): VS Code or WebStorm with missing-key underline + Problems panel -->

## Development path (where this is going)

i18n-doctor is currently in **beta (v0.9.x)**. The path so far:

1. **Core analyzer** — unused / missing / duplicate / coverage
2. **CLI + reports** — terminal, JSON, SARIF, Markdown, HTML
3. **Language server** — shared engine for editors
4. **VS Code + JetBrains plugins** — live diagnostics
5. **Smarter usages** — prop-passed `t`, static composition, dynamic softening, untranslated UI text

Next focus areas: more frameworks and edge cases, better suppressions/config ergonomics, and IDE features beyond diagnostics (hover / actions) when the analyzer is solid enough.

Feedback from real projects is the fastest way to stabilize toward v1.

## Who should use it

- Teams shipping multi-locale React / Vue / Next / Angular apps
- Maintainers cleaning up large locale JSON / catalogs
- Anyone who wants i18n checks in **CI and** the editor from one tool

If your translations matter to users, your keys deserve the same static scrutiny as TypeScript types.

## Links

- GitHub: https://github.com/taha-farzalizadeh/i18n-doctor
- npm (`i18n-doctor` / CLI): https://www.npmjs.com/package/i18n-doctor
- Issues / feedback: https://github.com/taha-farzalizadeh/i18n-doctor/issues
- VS Code extension: search **i18n-doctor** on the [Visual Studio Marketplace](https://marketplace.visualstudio.com/vscode)
- JetBrains / WebStorm plugin: search **i18n-doctor** on the [JetBrains Marketplace](https://plugins.jetbrains.com)

If you try it on your repo, open an issue with what it missed — that feedback shapes the beta.

---

*Built in the open. MIT-licensed. Still early — useful today, improving with every real project report.*
