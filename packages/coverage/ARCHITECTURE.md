# @i18n-unused/coverage — Architecture

## Goals

Analyze all locales against a **base locale** and report:

1. Missing keys per locale
2. Extra keys (present only outside the base)
3. Locale coverage percentage (overall + per-locale + per-namespace)
4. Nested key comparison (Locale Tree Model)
5. Structured issues with suggestions and clickable paths

## Non-goals

- Re-parsing JSON / JS / YAML locale files
- Usage / call-site analysis
- Auto-fixing missing translations

## Pipeline

```
TranslationCatalog  (@i18n-unused/sources)
        + optional EffectiveI18nSettings (@i18n-unused/context)
        │
        ▼
 Locale Merger      (group by namespace → key → locale; duplicate diagnostics)
        │
        ▼
 Locale resolution  (option → framework defaultLocale → en heuristic)
        │
        ▼
 Coverage Analyzer  (diff vs base; issues[]; byLocale %)
        │
        ▼
 Coverage Reporter  (terminal OSC-8 | JSON)
```

## Public API stability

Existing exports (`KeyCoverage`, `CoverageResult.keys/missing/extra/stats`,
`createCoverageAnalyzer`, `formatCoverageJson`, …) are unchanged in shape.
Additive fields only: `issues`, `diagnostics`, `stats.byLocale`,
`KeyCoverage.confidence`, options `useContext` / `fallbackLocales`.

## Performance

- Flat coverage analysis sets `buildTrees: false` (no nested tree allocation)
- Single-pass tree freeze when trees are requested
- No re-parse of locale files
- O(n) merge into Maps; stable sorts only on result sets
- Monorepo: merge catalogs once, analyze once

## Issue contract

```ts
{
  type: "missing-translation" | "extra-translation",
  key, locale, baseLocale, namespace?,
  filePath, absolutePath, line, column,
  confidence, suggestion,
  relatedFilePath?, relatedLine?, relatedColumn?
}
```

## Coverage math

Among cells `(baseKey × comparedLocale)`:

`coveragePercent = 100 * presentCells / totalCells`

Per-locale: `presentBaseKeys / baseKeyCount`.
Extras are reported separately and do not dilute base completeness cells.
