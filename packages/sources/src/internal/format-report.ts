import type { TranslationCatalog } from "../api/types.js";

export function formatCatalogReport(catalog: TranslationCatalog): string {
  const lines: string[] = [];
  lines.push("i18n-unused sources");
  lines.push(`Root: ${catalog.root}`);
  lines.push("");
  lines.push("Summary");
  lines.push(`  Sources:     ${catalog.stats.sourceCount}`);
  lines.push(`  Keys:        ${catalog.stats.keyCount}`);
  lines.push(`  Candidates:  ${catalog.stats.candidateCount}`);
  lines.push(
    `  Locales:     ${catalog.locales.length ? catalog.locales.join(", ") : "(none)"}`,
  );
  lines.push(
    `  Namespaces:  ${catalog.namespaces.length ? catalog.namespaces.join(", ") : "(none)"}`,
  );
  lines.push("");

  lines.push("By format");
  for (const [format, count] of Object.entries(catalog.stats.byFormat)) {
    if (count > 0) {
      lines.push(`  - ${format}: ${count}`);
    }
  }
  lines.push("");

  lines.push("Sources");
  if (catalog.sources.length === 0) {
    lines.push("  (none)");
  } else {
    for (const source of catalog.sources.slice(0, 30)) {
      const meta = [
        source.kind,
        source.locale ? `locale=${source.locale}` : undefined,
        source.namespace ? `ns=${source.namespace}` : undefined,
        `${Math.round(source.confidence * 100)}%`,
      ]
        .filter(Boolean)
        .join(", ");
      lines.push(`  - ${source.filePath} (${meta})`);
      lines.push(`      keys: ${source.keys.length}`);
      for (const key of source.keys.slice(0, 3)) {
        const preview =
          typeof key.value === "string"
            ? JSON.stringify(key.value).slice(0, 40)
            : String(key.value);
        lines.push(`      • ${key.key} = ${preview}`);
      }
      if (source.keys.length > 3) {
        lines.push(`      • +${source.keys.length - 3} more`);
      }
    }
    if (catalog.sources.length > 30) {
      lines.push(`  … +${catalog.sources.length - 30} more sources`);
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
    `Timings: total ${catalog.timings.totalMs.toFixed(1)}ms (scan ${catalog.timings.scanMs.toFixed(1)}ms, detect ${catalog.timings.detectMs.toFixed(1)}ms, extract ${catalog.timings.extractMs.toFixed(1)}ms)`,
  );

  return lines.join("\n");
}
