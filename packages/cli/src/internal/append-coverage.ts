/**
 * Merge locale coverage into check reports.
 * For terminal: inject RIGHT AFTER the issues Summary so it is visible
 * before the long per-issue dump (often 1000+ blocks).
 */

import type { CoverageResult } from "@i18n-doctor/coverage";
import { formatCoverageJson } from "@i18n-doctor/coverage";
import type { CliOutputFormat } from "../api/types.js";

export function appendCoverageToReport(
  issuesReport: string,
  coverage: CoverageResult | undefined,
  format: CliOutputFormat,
  options: {
    readonly color?: boolean;
    readonly hyperlinks?: boolean;
  } = {},
): string {
  if (!coverage) return issuesReport;
  if (format === "silent") return issuesReport;

  if (format === "json") {
    return mergeJsonReports(issuesReport, coverage);
  }

  if (format === "terminal") {
    return injectTerminalCoverage(issuesReport, coverage, options);
  }

  if (format === "markdown") {
    return `${formatCompactCoverageMarkdown(coverage)}\n\n${issuesReport.trimStart()}`;
  }

  if (format === "html") {
    return `${coverageHtmlSnippet(coverage)}\n${issuesReport}`;
  }

  return issuesReport;
}

function injectTerminalCoverage(
  issuesReport: string,
  coverage: CoverageResult,
  options: { readonly color?: boolean },
): string {
  const color = options.color !== false;
  const block = formatCompactCoverageTerminal(coverage, color);

  // Insert after "Total: N\n\n" in the issues Summary.
  const re = /(Total:\s+\d+[^\n]*\n\n)/;
  const match = re.exec(issuesReport);
  if (match && match.index !== undefined) {
    const at = match.index + match[0].length;
    return (
      issuesReport.slice(0, at) + block + "\n" + issuesReport.slice(at)
    );
  }

  // Fallback: place after header root line
  const rootRe = /(Root:[^\n]*\n\n)/;
  const rootMatch = rootRe.exec(issuesReport);
  if (rootMatch && rootMatch.index !== undefined) {
    const at = rootMatch.index + rootMatch[0].length;
    return (
      issuesReport.slice(0, at) + block + "\n" + issuesReport.slice(at)
    );
  }

  return `${block}\n${issuesReport}`;
}

function formatCompactCoverageTerminal(
  coverage: CoverageResult,
  color: boolean,
): string {
  const paint = (code: string, text: string) =>
    color ? `${code}${text}\u001b[0m` : text;
  const BOLD = "\u001b[1m";
  const DIM = "\u001b[2m";
  const YELLOW = "\u001b[33m";
  const RED = "\u001b[31m";
  const GREEN = "\u001b[32m";
  const CYAN = "\u001b[36m";

  const lines: string[] = [];
  lines.push(paint(BOLD, "Locale coverage"));
  lines.push(
    `  ${paint(DIM, "Base:")} ${coverage.baseLocale}  ${paint(DIM, "Locales:")} ${coverage.locales.join(", ") || "(none)"}`,
  );
  lines.push(
    `  ${paint(GREEN, "Coverage:")} ${coverage.stats.coveragePercent}%`,
  );
  lines.push(
    `  ${paint(RED, "Missing in other langs:")} ${coverage.stats.missingCount}`,
  );
  lines.push(
    `  ${paint(YELLOW, "Extra (not in base):")} ${coverage.stats.extraCount}`,
  );

  if (coverage.stats.byLocale && coverage.stats.byLocale.length > 0) {
    for (const loc of coverage.stats.byLocale) {
      const pct = Math.round(loc.coverage * 1000) / 10;
      lines.push(
        `  ${paint(CYAN, loc.locale)}  ${pct}%  (${loc.presentCount}/${loc.baseKeyCount} keys)`,
      );
    }
  }

  const maxShow = 25;
  if (coverage.missing.length > 0) {
    lines.push("");
    lines.push(paint(BOLD, "Missing in some locales"));
    const slice = coverage.missing.slice(0, maxShow);
    for (const m of slice) {
      const ns = m.namespace ? `[${m.namespace}] ` : "";
      lines.push(
        `  ${paint(RED, "x")} ${ns}${m.key}  → missing in: ${m.missingLocales.join(", ")}`,
      );
      const baseFile = m.files.find((f) => f.locale === m.baseLocale);
      if (baseFile) {
        lines.push(
          `      ${paint(DIM, "base:")} ${baseFile.relativePath}:${baseFile.line}:${baseFile.column}`,
        );
      }
    }
    if (coverage.missing.length > maxShow) {
      lines.push(
        paint(
          DIM,
          `  ... +${coverage.missing.length - maxShow} more (use --json for full list)`,
        ),
      );
    }
  } else if (coverage.locales.length <= 1) {
    lines.push("");
    lines.push(
      paint(
        DIM,
        "  (Only one locale detected — nothing to compare across languages.)",
      ),
    );
  } else {
    lines.push("");
    lines.push(
      paint(GREEN, "  All compared locales include the base key set."),
    );
  }

  if (coverage.extra.length > 0) {
    lines.push("");
    lines.push(paint(BOLD, "Extra keys (not in base)"));
    for (const e of coverage.extra.slice(0, 10)) {
      const ns = e.namespace ? `[${e.namespace}] ` : "";
      lines.push(
        `  ${paint(YELLOW, "!")} ${ns}${e.key}  → only in: ${e.locales.join(", ")}`,
      );
    }
    if (coverage.extra.length > 10) {
      lines.push(
        paint(DIM, `  ... +${coverage.extra.length - 10} more`),
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}

function mergeJsonReports(
  issuesReport: string,
  coverage: CoverageResult,
): string {
  try {
    const issues = JSON.parse(issuesReport) as Record<string, unknown>;
    const coveragePayload = JSON.parse(
      formatCoverageJson(coverage, {
        includeAllKeys: false,
        includeIssues: true,
        pretty: false,
      }),
    ) as Record<string, unknown>;
    const merged = {
      ...issues,
      coverage: {
        baseLocale: coveragePayload["baseLocale"],
        locales: coveragePayload["locales"],
        namespaces: coveragePayload["namespaces"],
        stats: coveragePayload["stats"],
        missing: coveragePayload["missing"],
        extra: coveragePayload["extra"],
        issues: coveragePayload["issues"],
        diagnostics: coveragePayload["diagnostics"],
      },
    };
    return `${JSON.stringify(merged, null, 2)}\n`;
  } catch {
    return issuesReport;
  }
}

function formatCompactCoverageMarkdown(coverage: CoverageResult): string {
  const lines = [
    "## Locale coverage",
    "",
    `Base locale: \`${coverage.baseLocale}\` · Locales: ${coverage.locales.join(", ")}`,
    `Coverage: **${coverage.stats.coveragePercent}%**`,
    `Missing in other langs: **${coverage.stats.missingCount}**`,
    `Extra (not in base): **${coverage.stats.extraCount}**`,
    "",
  ];
  if (coverage.missing.length > 0) {
    lines.push("### Missing in some locales", "");
    for (const m of coverage.missing.slice(0, 40)) {
      const ns = m.namespace ? ` [${m.namespace}]` : "";
      lines.push(
        `- \`${m.key}\`${ns} — missing in: ${m.missingLocales.join(", ")}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

function coverageHtmlSnippet(coverage: CoverageResult): string {
  const rows = coverage.missing
    .slice(0, 40)
    .map((m) => {
      const ns = m.namespace ?? "";
      return `<tr><td>${escape(m.key)}</td><td>${escape(ns)}</td><td>${escape(m.missingLocales.join(", "))}</td></tr>`;
    })
    .join("\n");
  return `<section>
<h2>Locale coverage</h2>
<p>Base: <code>${escape(coverage.baseLocale)}</code> · Coverage: <strong>${coverage.stats.coveragePercent}%</strong> · Missing in other langs: <strong>${coverage.stats.missingCount}</strong></p>
<table>
<thead><tr><th>Key</th><th>Namespace</th><th>Missing locales</th></tr></thead>
<tbody>${rows || "<tr><td colspan=3>No missing locale keys</td></tr>"}</tbody>
</table>
</section>`;
}

function escape(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
