# @i18n-doctor/translation-index

Cached translation-key index for **Go to Translation**, **Hover**, and
**Completion**. Built from an existing `@i18n-doctor/sources`
`TranslationCatalog` — it does **not** re-parse locale files.

```
TranslationCatalog
        ↓
buildTranslationIndex()
        ↓
lookup / hasKey / definitionsForUsage / hoverForUsage / completionsForPrefix
```

Matching uses the same `definitionMatchesUsage` / `logicalKey` rules as the
issue engine so ESLint `no-missing-key` and the Language Server agree.

IDE features (definition / hover / completion) are exposed by
`@i18n-doctor/language-server` and consumed by the VS Code and JetBrains
extensions. ESLint continues to provide diagnostics only.
