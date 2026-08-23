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
2. Add `"nonexistent"` under `auth` in `locales/en.json` — underline disappears.
3. Remove it — underline returns.
4. Unused keys are underlined on the **key** token in each locale file.

### Screenshots for Marketplace

Use this project when capturing screenshots for [MARKETPLACE.md](../MARKETPLACE.md).
