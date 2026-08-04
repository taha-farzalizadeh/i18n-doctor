# Example outputs

## Help

```text
Usage: i18n-doctor [options] [command]

Static localization analysis — unused, missing, and duplicate translation keys

Options:
  -V, --version         Print CLI version
  -h, --help            Display help

Commands:
  check [options] [path]  Analyze a project for unused, missing, and duplicate keys
```

## Version

```text
0.0.0
```

## Terminal (default)

```text
· Discovering project…
· Loading configuration…
· Detecting framework…
· Collecting translation sources…
· Detecting translation usages…
· Analyzing issues…
✓ Done (412ms)

i18n-doctor issues
Root: /Users/you/app

Summary
  Unused:    2
  Missing:   1
  Duplicate: 0
  Total:     3

! UNUSED KEY  auth.legacy.banner
  key: auth.legacy.banner
  Defined  locales/en/auth.json:12:3
  …

x MISSING KEY  home.cta
  key: home.cta
  Used  src/pages/Home.tsx:44:18
  …
```

Paths use OSC-8 hyperlinks in supported terminals (`file://…` targets).

## JSON (`--json`)

```json
{
  "root": "/Users/you/app",
  "stats": {
    "total": 3,
    "unusedKey": 2,
    "missingKey": 1,
    "duplicateKey": 0,
    "bySeverity": { "error": 1, "warning": 2 }
  },
  "timings": { "totalMs": 18, "analyzeMs": 2 },
  "issues": [
    {
      "type": "missing-key",
      "severity": "error",
      "key": "home.cta",
      "file": "src/pages/Home.tsx",
      "line": 44,
      "column": 18,
      "message": "Missing translation key \"home.cta\""
    }
  ]
}
```

## SARIF (`--sarif`)

SARIF 2.1.0 document with `runs[0].results[]` mapped from issues (`ruleId` = issue type).

## Markdown (`--markdown`)

```markdown
# i18n-doctor report

**Root:** `/Users/you/app`

## Summary

| Kind | Count |
| --- | ---: |
| Unused | 2 |
| Missing | 1 |
| Duplicate | 0 |
| Total | 3 |
```

## HTML (`--html`)

Standalone HTML table with clickable `file://` location links.

## Fix (reserved)

```text
Not implemented yet
```

## Errors

```text
error[NOT_FOUND]: Path does not exist: /missing
hint: Pass an existing project directory to `i18n-doctor check`.

error[CONFIG]: Invalid severity for rule "unused-key"
error[PERMISSION]: Cannot access project path /secret: permission denied
```

## Silent (`--silent`)

No stdout report; exit code still reflects configured failure policy.
