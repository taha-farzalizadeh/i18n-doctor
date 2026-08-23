# Examples

## demo-project

Minimal app used for the Phase 17 acceptance check.

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

5. Add `"nonexistent": "…"` under `auth` in `locales/en.json` (and ideally
   `fa.json`). The underline disappears without reloading.

6. Remove the key. The underline returns.

The demo has **no** dependency on `i18n-doctor` or the language server — the
extension carries the server.

## launch.json

`.vscode/launch.json` in this package starts the Extension Development Host
against the built `dist/extension.js`.
