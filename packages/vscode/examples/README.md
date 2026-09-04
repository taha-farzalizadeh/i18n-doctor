# Examples

## demo-project

Minimal app used for IDE acceptance (diagnostics + Phase 20 intelligence).

1. From the monorepo root, build the extension:

   ```bash
   npm run build -w @i18n-doctor/language-server
   npm run build -w i18n-doctor-vscode
   ```

2. Open the monorepo in VS Code and press F5 (Run Extension).

3. In the Extension Development Host, open
   `packages/vscode/examples/demo-project`.

4. Open `src/Login.tsx`. Expect:

   - Extension activates
   - Language server starts (see the **i18n-doctor** output channel)
   - `"auth.nonexistent"` is underlined
   - The Problems panel shows
     `Translation key "auth.nonexistent" does not exist.` with
     `source: i18n-doctor`

5. **Go to Translation** — Cmd/Ctrl+Click (or F12) on `"auth.login"` → jumps to
   `locales/en.json` on the `login` property.

6. **Hover** — hover `"auth.login"` → English / Persian values, source path.

7. **Completion** — type `t("auth.")` → suggestions include `auth.login`,
   `auth.logout` with translated detail.

8. Add `"nonexistent": "…"` under `auth` in `locales/en.json` (and ideally
   `fa.json`). The underline disappears without reloading.

9. Remove the key. The underline returns.

The demo has **no** dependency on `i18n-doctor` or the language server — the
extension carries the server.

> ESLint provides diagnostics only. Go to Translation, Hover, and Completion
> come from the Language Server via this extension.

## launch.json

`.vscode/launch.json` in this package starts the Extension Development Host
against the built `dist/extension.js`.
