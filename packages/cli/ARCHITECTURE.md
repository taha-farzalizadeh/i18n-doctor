# @i18n-unused/cli — Architecture

## Responsibilities

The CLI owns **orchestration only**:

- command parsing (Commander)
- project discovery + path normalization
- configuration loading (`@i18n-unused/config`)
- framework detection (`@i18n-unused/detect`)
- invoking existing analyzers (`sources` → `usages` → `issues`)
- ignore / suppression / rule policy application (config engines)
- monorepo package scoping
- reporter selection + deterministic machine formats
- progress + timings (TTY / Unicode / color aware)
- exit codes

It never reimplements key matching, AST analysis, or catalog extraction.

## Pipeline

```
argv
  → Commander (check | --help | --version)
  → discoverProject (walk-up package.json, permission checks)
  → assertConfigReadable (--config)
  → createEffectiveConfigResolver().resolve / resolveMonorepo
  → createDetector().detect
  → Promise.all(sources.discover, usages.detect)   # per package scope
  → filter facts (IgnoreEngine + --locale/--namespace)
  → createIssueEngine().analyze
  → applyIssuePolicies (rules + SuppressionEngine)
  → mergeAnalysisResults (monorepo)
  → selectReporter → stdout
  → config.exit.exitCode
```

## Folder structure

```
packages/cli/
  package.json          # bin: i18n-unused
  ARCHITECTURE.md
  examples/outputs.md
  src/
    bin.ts
    cli.ts
    index.ts
    api/types.ts
    commands/check.ts
    internal/
      discover.ts
      errors.ts
      filter.ts
      format-options.ts
      merge-results.ts
      paths.ts
      progress.ts
      run-check.ts
      scan-limits.ts
      supports.ts       # color / Unicode / hyperlinks
      version.ts
      reporters/select.ts
  tests/
```

## Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | Success (or `--fix` stub) |
| 1 | Analysis failures per `exitOnError` / `failOnWarning` |
| 2 | Usage / config / I/O / permission errors |

## Cross-platform notes

- Report relative paths are POSIX (`/`) for stable CI diffs
- Progress glyphs fall back to ASCII on legacy Windows consoles
- `NO_COLOR` / `FORCE_COLOR` / `CI` respected
- Hyperlinks enabled for Windows Terminal, iTerm, VS Code, macOS TTY
- Large projects: `I18N_UNUSED_MAX_FILES`, `I18N_UNUSED_MAX_CANDIDATES`, `I18N_UNUSED_MAX_SOURCE_FILES`
