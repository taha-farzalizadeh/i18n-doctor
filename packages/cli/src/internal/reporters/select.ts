/**
 * CLI reporter selection + formatters for formats not in @i18n-unused/issues.
 * Machine formats produce deterministic, POSIX-path output.
 */

import type { AnalysisResult, Issue } from "@i18n-unused/issues";
import {
  createJsonReporter,
  createTerminalReporter,
  toFileUrl,
} from "@i18n-unused/issues";
import type {
  CliOutputFormat,
  CliReportContext,
  CliReporter,
} from "../../api/types.js";
import { toPosixPath } from "../paths.js";

export function selectReporter(
  format: CliOutputFormat,
  context: CliReportContext = {},
): CliReporter {
  switch (format) {
    case "terminal":
      return wrapIssuesReporter(
        "terminal",
        createTerminalReporter({
          ...(context.color !== undefined ? { color: context.color } : {}),
          hyperlinks: context.hyperlinks ?? false,
        }),
        context,
      );
    case "json":
      return wrapIssuesReporter(
        "json",
        createJsonReporter({
          verbose: context.verbose ?? false,
          pretty: true,
        }),
        context,
        /* stabilize */ true,
      );
    case "sarif":
      return createSarifReporter(context);
    case "markdown":
      return createMarkdownReporter(context);
    case "html":
      return createHtmlReporter(context);
    case "silent":
      return {
        id: "silent",
        report() {
          return "";
        },
      };
  }
}

function wrapIssuesReporter(
  id: CliOutputFormat,
  reporter: { report(result: AnalysisResult): string | void },
  context: CliReportContext,
  stabilize = false,
): CliReporter {
  return {
    id,
    report(result) {
      const input = stabilize ? stabilizeResult(result) : result;
      const body = reporter.report(input);
      const text = typeof body === "string" ? body : "";
      if (id !== "terminal" || !context.timings || !context.verbose) {
        return text;
      }
      return appendCliTimings(text, context);
    },
  };
}

/** Sort issues + POSIX-normalize relative paths for stable machine output. */
export function stabilizeResult(result: AnalysisResult): AnalysisResult {
  const issues = sortIssues(
    result.issues.map((issue) => normalizeIssuePaths(issue)),
  );
  return {
    root: toPosixPath(result.root),
    issues,
    stats: result.stats,
    timings: {
      totalMs: Math.round(result.timings.totalMs),
      analyzeMs: Math.round(result.timings.analyzeMs),
    },
  };
}

export function sortIssues(issues: readonly Issue[]): Issue[] {
  return [...issues].sort((a, b) => {
    const byType = a.type.localeCompare(b.type);
    if (byType !== 0) return byType;
    const byKey = a.key.localeCompare(b.key);
    if (byKey !== 0) return byKey;
    const byFile = toPosixPath(a.location.relativePath).localeCompare(
      toPosixPath(b.location.relativePath),
    );
    if (byFile !== 0) return byFile;
    if (a.location.line !== b.location.line) {
      return a.location.line - b.location.line;
    }
    return a.location.column - b.location.column;
  });
}

function normalizeIssuePaths(issue: Issue): Issue {
  return {
    ...issue,
    location: {
      ...issue.location,
      relativePath: toPosixPath(issue.location.relativePath),
    },
    relatedLocations: issue.relatedLocations.map((loc) => ({
      ...loc,
      relativePath: toPosixPath(loc.relativePath),
    })),
  };
}

function appendCliTimings(text: string, context: CliReportContext): string {
  const t = context.timings;
  if (!t) return text;
  const lines = [
    "",
    "CLI timings:",
    `  discover  ${fmt(t.discoverMs)}`,
    `  config    ${fmt(t.configMs)}`,
    `  detect    ${fmt(t.detectMs)}`,
    `  sources   ${fmt(t.sourcesMs)}`,
    `  usages    ${fmt(t.usagesMs)}`,
    `  analyze   ${fmt(t.analyzeMs)}`,
    `  filter    ${fmt(t.filterMs)}`,
    `  report    ${fmt(t.reportMs)}`,
    `  total     ${fmt(t.totalMs)}`,
  ];
  if (context.detection?.primary.framework) {
    lines.splice(
      1,
      0,
      `Framework: ${context.detection.primary.framework.id}` +
        (context.detection.primary.i18nLibrary
          ? ` / ${context.detection.primary.i18nLibrary.id}`
          : ""),
    );
  }
  return `${text.trimEnd()}\n${lines.join("\n")}\n`;
}

function fmt(ms: number): string {
  return `${Math.round(ms)}ms`;
}

export function createSarifReporter(context: CliReportContext = {}): CliReporter {
  return {
    id: "sarif",
    report(result) {
      void context;
      const stable = stabilizeResult(result);
      const runs = [
        {
          tool: {
            driver: {
              name: "i18n-unused",
              informationUri: "https://github.com/i18n-unused/i18n-unused",
              rules: [
                {
                  id: "duplicate-key",
                  shortDescription: { text: "Duplicate translation key" },
                  defaultConfiguration: { level: "warning" },
                },
                {
                  id: "missing-key",
                  shortDescription: { text: "Missing translation key" },
                  defaultConfiguration: { level: "error" },
                },
                {
                  id: "unused-key",
                  shortDescription: { text: "Unused translation key" },
                  defaultConfiguration: { level: "warning" },
                },
              ],
            },
          },
          results: stable.issues.map((issue) => ({
            ruleId: issue.type,
            level: sarifLevel(issue.severity),
            message: { text: issue.message },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: {
                    uri: toPosixPath(issue.location.relativePath),
                  },
                  region: {
                    startLine: issue.location.line,
                    startColumn: issue.location.column,
                  },
                },
              },
            ],
          })),
        },
      ];
      // Stable key order for deterministic JSON.
      return `${JSON.stringify(
        {
          $schema: "https://json.schemastore.org/sarif-2.1.0.json",
          version: "2.1.0",
          runs,
        },
        null,
        2,
      )}\n`;
    },
  };
}

function sarifLevel(
  severity: "error" | "warning" | "info",
): "error" | "warning" | "note" {
  if (severity === "info") return "note";
  return severity;
}

export function createMarkdownReporter(
  context: CliReportContext = {},
): CliReporter {
  return {
    id: "markdown",
    report(result) {
      const stable = stabilizeResult(result);
      const lines: string[] = [
        "# i18n-unused report",
        "",
        `**Root:** \`${stable.root}\``,
        "",
        "## Summary",
        "",
        `| Kind | Count |`,
        `| --- | ---: |`,
        `| Unused | ${stable.stats.unusedKey} |`,
        `| Missing | ${stable.stats.missingKey} |`,
        `| Duplicate | ${stable.stats.duplicateKey} |`,
        `| Total | ${stable.stats.total} |`,
        "",
      ];

      if (stable.issues.length === 0) {
        lines.push("No issues found.", "");
      } else {
        lines.push("## Issues", "");
        for (const issue of stable.issues) {
          const rel = toPosixPath(issue.location.relativePath);
          const loc = `${rel}:${issue.location.line}:${issue.location.column}`;
          lines.push(
            `### \`${issue.key}\` (${issue.type}, ${issue.severity})`,
            "",
            issue.message,
            "",
            `- Location: [\`${loc}\`](${toFileUrl(issue.location)})`,
            "",
          );
        }
      }

      if (context.verbose && context.timings) {
        lines.push(
          `*CLI total: ${Math.round(context.timings.totalMs)}ms*`,
          "",
        );
      }
      return `${lines.join("\n")}`;
    },
  };
}

export function createHtmlReporter(context: CliReportContext = {}): CliReporter {
  return {
    id: "html",
    report(result) {
      void context;
      const stable = stabilizeResult(result);
      const rows = stable.issues
        .map((issue) => {
          const rel = toPosixPath(issue.location.relativePath);
          const loc = `${escapeHtml(rel)}:${issue.location.line}:${issue.location.column}`;
          const href = toFileUrl(issue.location);
          return `<tr>
  <td>${escapeHtml(issue.severity)}</td>
  <td>${escapeHtml(issue.type)}</td>
  <td><code>${escapeHtml(issue.key)}</code></td>
  <td><a href="${escapeHtml(href)}">${loc}</a></td>
  <td>${escapeHtml(issue.message)}</td>
</tr>`;
        })
        .join("\n");

      return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>i18n-unused report</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; color: #111; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 0.5rem 0.75rem; text-align: left; vertical-align: top; }
  th { background: #f4f4f5; }
  code { font-family: ui-monospace, monospace; }
  .meta { color: #52525b; margin-bottom: 1.5rem; }
</style>
</head>
<body>
<h1>i18n-unused report</h1>
<p class="meta">Root: <code>${escapeHtml(stable.root)}</code></p>
<p>Unused: <strong>${stable.stats.unusedKey}</strong> &#183;
Missing: <strong>${stable.stats.missingKey}</strong> &#183;
Duplicate: <strong>${stable.stats.duplicateKey}</strong> &#183;
Total: <strong>${stable.stats.total}</strong></p>
<table>
<thead><tr><th>Severity</th><th>Type</th><th>Key</th><th>Location</th><th>Message</th></tr></thead>
<tbody>
${rows || `<tr><td colspan="5">No issues found</td></tr>`}
</tbody>
</table>
</body>
</html>
`;
    },
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
