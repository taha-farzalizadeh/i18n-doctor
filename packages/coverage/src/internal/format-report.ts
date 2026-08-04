/**
 * Terminal coverage reporter — clickable paths + suggestions.
 */

import { pathToFileURL } from "node:url";
import type { CoverageIssue, CoverageResult } from "../api/types.js";

export interface TerminalCoverageReporterOptions {
  readonly color?: boolean;
  readonly hyperlinks?: boolean;
  /** Max missing keys to print (0 = unlimited). @default 50 */
  readonly maxMissing?: number;
  readonly maxExtra?: number;
  /** Prefer structured issues[] when present. @default true */
  readonly useIssues?: boolean;
}

export function formatCoverageReport(
  result: CoverageResult,
  options: TerminalCoverageReporterOptions = {},
): string {
  const color = resolveColor(options.color);
  const hyperlinks = resolveHyperlinks(options.hyperlinks, color);
  const maxMissing = options.maxMissing ?? 50;
  const maxExtra = options.maxExtra ?? 50;
  const useIssues = options.useIssues !== false;
  const paint = (code: string, text: string) =>
    color ? `${code}${text}\u001b[0m` : text;

  const BOLD = "\u001b[1m";
  const DIM = "\u001b[2m";
  const YELLOW = "\u001b[33m";
  const RED = "\u001b[31m";
  const GREEN = "\u001b[32m";
  const CYAN = "\u001b[36m";

  const lines: string[] = [];
  lines.push(paint(BOLD, "i18n-unused coverage"));
  lines.push(`${paint(DIM, "Root:")} ${result.root}`);
  lines.push(`${paint(DIM, "Base locale:")} ${result.baseLocale}`);
  lines.push(
    `${paint(DIM, "Locales:")} ${result.locales.join(", ") || "(none)"}`,
  );
  lines.push("");
  lines.push(paint(BOLD, "Summary"));
  lines.push(
    `  ${paint(GREEN, "Coverage:")}  ${result.stats.coveragePercent}%`,
  );
  lines.push(`  Keys:       ${result.stats.totalKeys}`);
  lines.push(`  ${paint(RED, "Missing:")}    ${result.stats.missingCount}`);
  lines.push(`  ${paint(YELLOW, "Extra:")}      ${result.stats.extraCount}`);
  lines.push("");

  if (result.stats.byLocale && result.stats.byLocale.length > 0) {
    lines.push(paint(BOLD, "Locales"));
    for (const loc of result.stats.byLocale) {
      const pct = Math.round(loc.coverage * 1000) / 10;
      lines.push(
        `  ${paint(CYAN, loc.locale)}  ${pct}%  (${loc.presentCount}/${loc.baseKeyCount} base keys, extra=${loc.extraCount})`,
      );
    }
    lines.push("");
  }

  if (result.stats.byNamespace.length > 0) {
    lines.push(paint(BOLD, "Namespaces"));
    for (const ns of result.stats.byNamespace) {
      const pct = Math.round(ns.coverage * 1000) / 10;
      lines.push(
        `  ${paint(CYAN, ns.namespace)}  ${pct}%  (keys=${ns.keyCount}, missing=${ns.missingCount}, extra=${ns.extraCount})`,
      );
    }
    lines.push("");
  }

  const issues = result.issues ?? [];
  const missingIssues = issues.filter((i) => i.type === "missing-translation");
  const extraIssues = issues.filter((i) => i.type === "extra-translation");

  if (
    result.missing.length === 0 &&
    result.extra.length === 0 &&
    issues.length === 0
  ) {
    lines.push(
      paint(GREEN, "All compared locales are consistent with the base."),
    );
    lines.push("");
    appendDiagnostics(lines, result, paint, DIM, YELLOW);
    lines.push(
      `${paint(DIM, "Timings:")} ${Math.round(result.timings.totalMs)}ms`,
    );
    return lines.join("\n");
  }

  if (useIssues && missingIssues.length > 0) {
    lines.push(paint(BOLD, "Missing translations"));
    const slice =
      maxMissing > 0 ? missingIssues.slice(0, maxMissing) : missingIssues;
    for (const issue of slice) {
      lines.push(...formatIssueBlock(issue, { paint, hyperlinks, RED, DIM }));
    }
    if (maxMissing > 0 && missingIssues.length > maxMissing) {
      lines.push(
        paint(DIM, `  ... +${missingIssues.length - maxMissing} more`),
      );
    }
    lines.push("");
  } else if (result.missing.length > 0) {
    lines.push(paint(BOLD, "Missing keys"));
    const slice =
      maxMissing > 0 ? result.missing.slice(0, maxMissing) : result.missing;
    for (const m of slice) {
      const ns = m.namespace ? `[${m.namespace}] ` : "";
      lines.push(
        `  ${paint(RED, "x")} ${ns}${m.key}  missing in: ${m.missingLocales.join(", ")}`,
      );
    }
    lines.push("");
  }

  if (useIssues && extraIssues.length > 0) {
    lines.push(paint(BOLD, "Extra translations"));
    const slice =
      maxExtra > 0 ? extraIssues.slice(0, maxExtra) : extraIssues;
    for (const issue of slice) {
      lines.push(
        ...formatIssueBlock(issue, { paint, hyperlinks, RED: YELLOW, DIM }),
      );
    }
    if (maxExtra > 0 && extraIssues.length > maxExtra) {
      lines.push(paint(DIM, `  ... +${extraIssues.length - maxExtra} more`));
    }
    lines.push("");
  } else if (result.extra.length > 0) {
    lines.push(paint(BOLD, "Extra keys (not in base)"));
    const slice =
      maxExtra > 0 ? result.extra.slice(0, maxExtra) : result.extra;
    for (const e of slice) {
      const ns = e.namespace ? `[${e.namespace}] ` : "";
      lines.push(
        `  ${paint(YELLOW, "!")} ${ns}${e.key}  only in: ${e.locales.join(", ")}`,
      );
    }
    lines.push("");
  }

  appendDiagnostics(lines, result, paint, DIM, YELLOW);
  lines.push(
    `${paint(DIM, "Timings:")} ${Math.round(result.timings.totalMs)}ms`,
  );
  return lines.join("\n");
}

function formatIssueBlock(
  issue: CoverageIssue,
  env: {
    paint: (code: string, text: string) => string;
    hyperlinks: boolean;
    RED: string;
    DIM: string;
  },
): string[] {
  const { paint, hyperlinks, RED, DIM } = env;
  const icon = issue.type === "missing-translation" ? "x" : "!";
  const ns = issue.namespace ? `[${issue.namespace}] ` : "";
  const lines: string[] = [
    `  ${paint(RED, icon)} ${paint("\u001b[1m", issue.type)}  ${ns}${issue.key}`,
    `      locale: ${issue.locale}  base: ${issue.baseLocale}  confidence: ${issue.confidence}`,
  ];
  if (issue.filePath) {
    const label = `${issue.filePath}:${issue.line}:${issue.column}`;
    lines.push(
      `      ${paint(DIM, "at")} ${formatPath(label, issue.absolutePath, hyperlinks)}`,
    );
  }
  lines.push(`      ${paint(DIM, "suggestion:")} ${issue.suggestion}`);
  return lines;
}

function formatPath(
  label: string,
  absolutePath: string,
  hyperlinks: boolean,
): string {
  if (!hyperlinks || !absolutePath) return label;
  try {
    const href = pathToFileURL(absolutePath).href;
    return `\u001b]8;;${href}\u0007${label}\u001b]8;;\u0007`;
  } catch {
    return label;
  }
}

function appendDiagnostics(
  lines: string[],
  result: CoverageResult,
  paint: (code: string, text: string) => string,
  DIM: string,
  YELLOW: string,
): void {
  const diags = result.diagnostics ?? [];
  if (diags.length === 0) return;
  lines.push(paint(DIM, "Diagnostics"));
  for (const d of diags.slice(0, 20)) {
    const tag = d.severity === "warning" ? paint(YELLOW, "warning") : d.severity;
    lines.push(`  ${tag}[${d.code}]: ${d.message}`);
  }
  lines.push("");
}

function resolveColor(force?: boolean): boolean {
  if (force === true) return true;
  if (force === false) return false;
  if (process.env["NO_COLOR"]) return false;
  if (process.env["FORCE_COLOR"]) return true;
  return Boolean(process.stdout.isTTY);
}

function resolveHyperlinks(force: boolean | undefined, color: boolean): boolean {
  if (force === true) return true;
  if (force === false) return false;
  if (!color) return false;
  if (process.env["FORCE_HYPERLINK"] === "1") return true;
  if (process.env["FORCE_HYPERLINK"] === "0") return false;
  if (process.env["CI"]) return false;
  return Boolean(process.stdout.isTTY);
}
