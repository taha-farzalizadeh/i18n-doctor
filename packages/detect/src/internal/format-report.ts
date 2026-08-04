import type { ProjectDetectionResult } from "../api/types.js";

/** Pretty-print detection result for CLI output. */
export function formatDetectionReport(result: ProjectDetectionResult): string {
  const lines: string[] = [];
  lines.push(`i18n-doctor detect`);
  lines.push(`Root: ${result.root}`);
  lines.push("");

  lines.push("Primary");
  lines.push(
    `  Framework:        ${formatPrimary(result.primary.framework)}`,
  );
  if (
    result.primary.framework?.id === "nextjs" &&
    result.primary.framework.nextRouter
  ) {
    lines.push(`  Next router:      ${result.primary.framework.nextRouter}`);
  }
  lines.push(
    `  Package manager:  ${formatPrimary(result.primary.packageManager)}`,
  );
  lines.push(`  Language:         ${formatPrimary(result.primary.language)}`);
  lines.push(
    `  i18n library:     ${formatPrimary(result.primary.i18nLibrary)}`,
  );
  lines.push("");

  lines.push("Frameworks");
  appendItems(lines, result.frameworks);
  lines.push("");

  lines.push("Package managers");
  appendItems(lines, result.packageManagers);
  lines.push("");

  lines.push("Languages");
  appendItems(lines, result.languages);
  lines.push("");

  lines.push("Localization libraries");
  appendItems(lines, result.i18nLibraries);
  lines.push("");

  if (result.unknowns.length > 0) {
    lines.push("Unknown / ambiguous");
    for (const unknown of result.unknowns) {
      lines.push(`  - [${unknown.category}] ${unknown.message}`);
    }
    lines.push("");
  }

  if (result.warnings.length > 0) {
    lines.push("Warnings");
    for (const warning of result.warnings) {
      lines.push(`  - ${warning.code}: ${warning.message}`);
    }
    lines.push("");
  }

  lines.push(
    `Timings: total ${result.timings.totalMs.toFixed(1)}ms (scan ${result.timings.scanMs.toFixed(1)}ms, analyze ${result.timings.analyzeMs.toFixed(1)}ms)`,
  );

  return lines.join("\n");
}

function formatPrimary(
  item: { name: string; confidence: number } | undefined,
): string {
  if (!item) {
    return "unknown";
  }
  return `${item.name} (${pct(item.confidence)})`;
}

function appendItems(
  lines: string[],
  items: readonly { name: string; confidence: number; evidence: readonly { message: string }[] }[],
): void {
  if (items.length === 0) {
    lines.push("  (none)");
    return;
  }
  for (const item of items) {
    lines.push(`  - ${item.name} ${pct(item.confidence)}`);
    for (const ev of item.evidence.slice(0, 3)) {
      lines.push(`      • ${ev.message}`);
    }
    if (item.evidence.length > 3) {
      lines.push(`      • +${item.evidence.length - 3} more`);
    }
  }
}

function pct(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}
