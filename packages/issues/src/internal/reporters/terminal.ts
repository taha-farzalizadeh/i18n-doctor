import type {
  AnalysisResult,
  FileLocation,
  Issue,
  Reporter,
  TerminalReporterOptions,
} from "../../api/types.js";
import {
  formatLocationLabel,
  toFileHref,
  toFileUrl,
} from "../location.js";

const RESET = "\u001b[0m";
const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const YELLOW = "\u001b[33m";
const RED = "\u001b[31m";
const CYAN = "\u001b[36m";
const GREEN = "\u001b[32m";

export function createTerminalReporter(
  options: TerminalReporterOptions = {},
): Reporter {
  return {
    id: "terminal",
    report(result: AnalysisResult): string {
      return formatTerminalReport(result, options);
    },
  };
}

export function formatTerminalReport(
  result: AnalysisResult,
  options: TerminalReporterOptions = {},
): string {
  const color = resolveColor(options.color);
  const hyperlinks = resolveHyperlinks(options.hyperlinks);
  const maxIssues = options.maxIssues ?? 0;

  const paint = (code: string, text: string) =>
    color ? `${code}${text}${RESET}` : text;

  const lines: string[] = [];
  lines.push(paint(BOLD, "i18n-doctor issues"));
  lines.push(`${paint(DIM, "Root:")} ${result.root}`);
  lines.push("");
  lines.push(paint(BOLD, "Summary"));
  lines.push(`  ${paint(YELLOW, "Unused:")}    ${result.stats.unusedKey}`);
  lines.push(`  ${paint(RED, "Missing:")}   ${result.stats.missingKey}`);
  lines.push(`  ${paint(CYAN, "Duplicate:")} ${result.stats.duplicateKey}`);
  lines.push(
    `  ${paint(CYAN, "Untranslated:")} ${result.stats.untranslatedText}`,
  );
  lines.push(`  Total:     ${result.stats.total}`);
  lines.push("");

  if (result.issues.length === 0) {
    lines.push(paint(GREEN, "No issues found"));
    lines.push("");
    lines.push(
      `${paint(DIM, "Timings:")} ${formatMs(result.timings.totalMs)}`,
    );
    return lines.join("\n");
  }

  const issues =
    maxIssues > 0 ? result.issues.slice(0, maxIssues) : result.issues;

  for (const issue of issues) {
    lines.push(...formatIssueBlock(issue, { hyperlinks, paint }));
    lines.push("");
  }

  if (maxIssues > 0 && result.issues.length > maxIssues) {
    lines.push(
      paint(
        DIM,
        `... +${result.issues.length - maxIssues} more issues (use maxIssues: 0 for all)`,
      ),
    );
    lines.push("");
  }

  lines.push(
    `${paint(DIM, "Timings:")} ${formatMs(result.timings.totalMs)}`,
  );
  return lines.join("\n");
}

function formatIssueBlock(
  issue: Issue,
  env: {
    hyperlinks: boolean;
    paint: (code: string, text: string) => string;
  },
): string[] {
  const { paint, hyperlinks } = env;
  const lines: string[] = [];
  const icon =
    issue.severity === "error"
      ? paint(RED, "x")
      : issue.severity === "warning"
        ? paint(YELLOW, "!")
        : "*";
  lines.push(`${icon} ${paint(BOLD, issueTitle(issue.type))}`);
  lines.push("");
  const displayKey = issue.source.namespace
    ? `${issue.source.namespace}:${issue.key}`
    : issue.key;
  lines.push(`  ${paint(BOLD, displayKey)}`);
  lines.push("");

  if (issue.type === "unused-key") {
    lines.push(`  ${paint(DIM, "Defined:")}`);
    appendLocations(lines, issue, hyperlinks, paint);
    lines.push("");
    lines.push(`  ${paint(DIM, "No usages found")}`);
  } else if (issue.type === "missing-key") {
    lines.push(`  ${paint(DIM, "Used:")}`);
    appendLocations(lines, issue, hyperlinks, paint);
    lines.push("");
    lines.push(`  ${paint(DIM, "No definition found")}`);
  } else if (issue.type === "untranslated-text") {
    lines.push(`  ${paint(DIM, "Location:")}`);
    appendLocations(lines, issue, hyperlinks, paint);
  } else {
    lines.push(`  ${paint(DIM, "Defined:")}`);
    appendLocations(lines, issue, hyperlinks, paint);
  }

  lines.push("");
  lines.push(`  ${paint(DIM, issue.message)}`);
  return lines;
}

function appendLocations(
  lines: string[],
  issue: Issue,
  hyperlinks: boolean,
  paint: (code: string, text: string) => string,
): void {
  lines.push(`  ${formatLocationLine(issue.location, hyperlinks, paint)}`);
  for (const related of issue.relatedLocations) {
    lines.push(`  ${formatLocationLine(related, hyperlinks, paint)}`);
  }
}

function issueTitle(type: Issue["type"]): string {
  switch (type) {
    case "unused-key":
      return "UNUSED KEY";
    case "missing-key":
      return "MISSING KEY";
    case "duplicate-key":
      return "DUPLICATE KEY";
    case "untranslated-text":
      return "UNTRANSLATED TEXT";
  }
}

function formatLocationLine(
  location: FileLocation,
  hyperlinks: boolean,
  paint: (code: string, text: string) => string,
): string {
  const label = formatLocationLabel(location);
  const locator = toFileUrl(location);
  if (hyperlinks) {
    // OSC-8 href must be a valid file URI (no :line:column suffix).
    const href = toFileHref(location.absolutePath);
    const linked = `\u001b]8;;${href}\u0007${label}\u001b]8;;\u0007`;
    return `${linked}  ${paint(DIM, locator)}`;
  }
  return `${label}  ${paint(DIM, locator)}`;
}

function resolveColor(option: boolean | undefined): boolean {
  if (option === true) return true;
  if (option === false) return false;
  return supportsColor();
}

/**
 * undefined → auto-detect; true → force OSC-8; false → plain text.
 * Forced mode keeps CI/fixture tests deterministic.
 */
function resolveHyperlinks(option: boolean | undefined): boolean {
  if (option === true) return true;
  if (option === false) return false;
  return supportsHyperlinks();
}

function formatMs(ms: number): string {
  return `${Math.round(ms)}ms`;
}

function supportsColor(): boolean {
  if (typeof process === "undefined") {
    return false;
  }
  if (process.env["FORCE_COLOR"] === "0") {
    return false;
  }
  if (process.env["FORCE_COLOR"] && process.env["FORCE_COLOR"] !== "0") {
    return true;
  }
  if (process.env["NO_COLOR"] !== undefined) {
    return false;
  }
  return process.stdout?.isTTY === true;
}

function supportsHyperlinks(): boolean {
  if (typeof process === "undefined") {
    return false;
  }
  if (process.env["FORCE_HYPERLINK"] === "1") {
    return true;
  }
  if (process.env["FORCE_HYPERLINK"] === "0") {
    return false;
  }
  if (process.stdout?.isTTY !== true) {
    return false;
  }

  const termProgram = process.env["TERM_PROGRAM"] ?? "";
  const term = process.env["TERM"] ?? "";
  const colorTerm = process.env["COLORTERM"] ?? "";

  return (
    termProgram === "iTerm.app" ||
    termProgram === "Apple_Terminal" ||
    termProgram === "vscode" ||
    termProgram === "ghostty" ||
    termProgram === "WezTerm" ||
    !!process.env["WT_SESSION"] ||
    !!process.env["KITTY_WINDOW_ID"] ||
    !!process.env["VTE_VERSION"] ||
    term.includes("xterm") ||
    colorTerm === "truecolor" ||
    colorTerm === "24bit"
  );
}
