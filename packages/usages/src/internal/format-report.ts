import type { TranslationUsage, UsageCatalog } from "../api/types.js";

export function formatUsageReport(catalog: UsageCatalog): string {
  const lines: string[] = [];
  lines.push("i18n-unused usages");
  lines.push(`Root: ${catalog.root}`);
  lines.push("");
  lines.push("Summary");
  lines.push(`  Files analyzed:  ${catalog.stats.fileCount}`);
  lines.push(`  Usages:          ${catalog.stats.usageCount}`);
  lines.push(
    `  Libraries:       ${catalog.libraries.length ? catalog.libraries.join(", ") : "(none)"}`,
  );
  lines.push("");

  lines.push("By library");
  for (const [lib, count] of Object.entries(catalog.stats.byLibrary)) {
    if (count) {
      lines.push(`  - ${lib}: ${count}`);
    }
  }
  lines.push("");

  lines.push("Usages");
  if (catalog.usages.length === 0) {
    lines.push("  (none)");
  } else {
    for (const usage of catalog.usages.slice(0, 50)) {
      lines.push(`  - ${formatUsageLine(usage)}`);
    }
    if (catalog.usages.length > 50) {
      lines.push(`  … +${catalog.usages.length - 50} more`);
    }
  }
  lines.push("");

  if (catalog.warnings.length > 0) {
    lines.push("Warnings");
    for (const warning of catalog.warnings) {
      lines.push(`  - ${warning.code}: ${warning.message}`);
    }
    lines.push("");
  }

  lines.push(
    `Timings: total ${catalog.timings.totalMs.toFixed(1)}ms (scan ${catalog.timings.scanMs.toFixed(1)}ms, detect ${catalog.timings.detectMs.toFixed(1)}ms, analyze ${catalog.timings.analyzeMs.toFixed(1)}ms)`,
  );

  return lines.join("\n");
}

export function formatUsageLine(usage: TranslationUsage): string {
  const ns = usage.namespace ? ` ns=${usage.namespace}` : "";
  return `${usage.relativePath}:${usage.location.line}:${usage.location.column}  ${usage.key}  [${usage.library}/${usage.context}${ns}] ${Math.round(usage.confidence * 100)}%`;
}

/** Compact diagnostic-style object for CLI JSON. */
export function usageToDiagnostic(usage: TranslationUsage): Record<string, unknown> {
  return {
    key: usage.key,
    file: usage.relativePath,
    absolutePath: usage.absolutePath,
    location: {
      line: usage.location.line,
      column: usage.location.column,
      endLine: usage.location.endLine,
      endColumn: usage.location.endColumn,
      start: usage.location.start,
      end: usage.location.end,
    },
    library: usage.library,
    ...(usage.namespace !== undefined ? { namespace: usage.namespace } : {}),
    confidence: usage.confidence,
    context: usage.context,
    ...(usage.evidence !== undefined ? { evidence: usage.evidence } : {}),
  };
}
