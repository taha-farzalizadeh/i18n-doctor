# Sources package — namespace-aware modeling (Phase 013.5)

## Problem

i18next projects often register resources dynamically:

```ts
i18next.addResourceBundle("en", "home", homeTranslations);
```

Path inference treats `…/i18n/en.ts` as locale-only (the `i18n` segment is ignored as a namespace stem). Keys were modeled as bare `SAVE` instead of `home:SAVE`, so unused/duplicate analysis collapsed across namespaces.

## Model

Every extracted key is a **TranslationEntry**:

| Field | Example |
| --- | --- |
| `locale` | `"en"` or `null` |
| `namespace` | `"home"` or `null` |
| `keyPath` | `"SAVE"` / `"nav.title"` |
| `fullKey` | `"en::home::SAVE"` |
| `sourceFile` | `"src/app/pages/home/i18n/en.ts"` |

`TranslationKeyDefinition` remains the public catalog leaf (backward compatible). Prefer `toTranslationEntry()` / `entriesFromCatalog()` for namespace-aware consumers. `fullKey` is populated by the detector.

Projects without namespaces keep `namespace: null` / omit `namespace` — soft matching in `@i18n-unused/issues` still works.

## Registration extraction (static only)

After candidate file extraction, the detector scans script files for:

1. **`addResourceBundle(lng, ns, resource)`** — attributes `locale` + `namespace` onto the resolved resource module (import / local object / inline literal).
2. **`addResource(lng, ns, key, value)`** — synthesizes a single-key source.
3. **`init({ resources })` / `createInstance({ resources })`** — expands the i18next resources tree (also via `extract-js` targets).

Import targets are resolved with `@i18n-unused/imports` (relative + tsconfig `paths`). Application code is never executed.

Unresolved dynamic registrations emit catalog warnings:

```txt
unresolved-resource-registration
```

## Downstream

- **Unused / missing**: match on key + namespace when both sides declare one (`home:SAVE` ≠ `settings:SAVE`).
- **Duplicates**: identity is `locale::namespace::key` — cross-namespace same leaf is not a duplicate.
- **Coverage**: already groups by namespace; benefits automatically once sources carry `namespace`.
- **Usages**: `useTranslation("home")`, `useTranslation(["a","b"])`, `t(key, { ns })`, and `const api = useTranslation("home"); api.t(...)` propagate namespace. Unresolved i18next namespaces use `namespaceResolved: false` and confidence `0.4`.

## Matching contract (`@i18n-unused/issues`)

| Definition | Usage | Result |
| --- | --- | --- |
| `home:SAVE` | `home:SAVE` | match |
| `home:SAVE` | `settings:SAVE` | no match |
| `home:SAVE` | bare `SAVE` | no match (avoids false "used") |
| `home:SAVE` | bare `SAVE` + `defaultNS=home` | match |
| `common:SAVE` | `home:SAVE` + `fallbackNS=[common]` | match |
| unnamespaced `SAVE` | any `SAVE` | match (legacy catalogs) |

Duplicates always key on `locale::namespace::key`.

## Performance

- Registration scan only opens files whose text matches `addResource(Bundle)?(` — not every `.init(`.
- Shares the candidate `AstEngine` cache with extraction (no second engine).
- Duplicate identical registrations are folded; conflicting ns for one file warns once.

## Migration

| Before | After |
| --- | --- |
| Read `key.key` only | Prefer `fullKey` / `TranslationEntry` |
| Path-only namespace | Registration attribution overrides path when present |
| Soft-match unnamespaced usage → any ns | Requires resolved ns / defaultNS / fallbackNS |

No breaking removals of public APIs. Additive fields only.
