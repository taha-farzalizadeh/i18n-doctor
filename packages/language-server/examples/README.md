# Examples

- [`vscode-client.md`](./vscode-client.md) — minimal VS Code extension.
- [`jetbrains-client.md`](./jetbrains-client.md) — minimal WebStorm/IntelliJ plugin.
- [`demo-project/`](./demo-project) — a namespaced project that produces one of
  each diagnostic.

## What the demo project reports

Open `demo-project` in any LSP-compatible IDE with the client wired up:

| File | Diagnostic | Why |
| --- | --- | --- |
| `src/Login.tsx` | `missing-key` on `"nonexistent"` | `auth:nonexistent` is not defined |
| `public/locales/en/auth.json` | `unused-key` on `forgotten` | `auth:forgotten` is never used |
| `public/locales/en/auth.json` | `missing-translation` on `forgotten` | `fa` has no `auth:forgotten` |

`settings:SAVE` and `settings:CANCEL` are both used and defined in every locale,
so `Settings.tsx` is clean — and `auth:SAVE` is never inferred from it, because
namespaces are not flattened.

## Trying the acceptance criteria by hand

1. Open `src/Login.tsx`. `t("nonexistent")` is underlined with
   `Translation key "auth:nonexistent" does not exist.`
2. **Go to Translation** — Cmd/Ctrl+Click / F12 on a known key → catalog entry.
3. **Hover** a key → locale values, namespace, source.
4. **Completion** — type inside `t("…")` → key suggestions with detail.
5. Add `"nonexistent": "Reset"` to `public/locales/en/auth.json`. The underline
   disappears within one debounce window, without saving `Login.tsx`.
6. Remove the key again. The underline comes back.

> ESLint provides diagnostics only. Go to Translation, Hover, and Completion
> come from this Language Server.

## Running the server directly

```bash
# From a project root, speaking LSP on stdin/stdout:
npx i18n-doctor-language-server --stdio --log-level debug
```

Logs go to the LSP log channel (or stderr when there is no client), never to
stdout.
