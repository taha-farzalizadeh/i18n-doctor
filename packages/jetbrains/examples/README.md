# JetBrains plugin examples

## demo-project

Minimal React + i18next project for local plugin development:

```bash
npm run runIde -w i18n-doctor-jetbrains
```

End users install **i18n-doctor** from the JetBrains Marketplace (not from this
folder).

### Expected behavior

1. Open `src/Login.tsx` — `t("auth.nonexistent")` underlines `"auth.nonexistent"`.
2. **Go to Translation** — Cmd/Ctrl+Click (or Go to Declaration) on `"auth.login"`
   → jumps to `locales/en.json`.
3. **Hover** `"auth.login"` → English / Persian values and source path.
4. **Completion** — type inside `t("auth.")` → `auth.login`, `auth.logout`, …
5. Add `"nonexistent"` under `auth` in `locales/en.json` — underline disappears.
6. Remove it — underline returns.
7. Unused keys are underlined on the **key** token in each locale file.

> ESLint provides diagnostics only. Go to Translation, Hover, and Completion
> come from the Language Server via this plugin.

### Screenshots for Marketplace

Use this project when capturing screenshots for [MARKETPLACE.md](../MARKETPLACE.md).
