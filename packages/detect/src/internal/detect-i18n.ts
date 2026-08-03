import type {
  DetectedI18nLibrary,
  DetectionEvidence,
  UnknownConfiguration,
} from "../api/types.js";
import { I18N_SPECS } from "./catalogs.js";
import {
  buildDetectedItem,
  evidence,
  filterByMinConfidence,
} from "./evidence.js";
import {
  findImport,
  hasDependency,
  hasPath,
  type DetectionContext,
} from "./context.js";
import { signalExample } from "./path-index.js";

export function detectI18nLibraries(
  ctx: DetectionContext,
  minConfidence: number,
): {
  items: DetectedI18nLibrary[];
  unknowns: UnknownConfiguration[];
} {
  const unknowns: UnknownConfiguration[] = [];
  const items: DetectedI18nLibrary[] = [];

  for (const spec of I18N_SPECS) {
    const evidenceList: DetectionEvidence[] = [];
    let hasStrongSignal = false;

    for (const pkg of spec.packages) {
      const hit = hasDependency(ctx.packageJsons, pkg.name, pkg.section ?? "any");
      if (hit.found) {
        hasStrongSignal = true;
        evidenceList.push(
          evidence(
            hit.section === "devDependency" ? "devDependency" : "dependency",
            `package.json lists ${pkg.name}`,
            pkg.weight,
            hit.path,
            hit.section,
          ),
        );
      }
    }

    for (const specImport of spec.imports) {
      const paths = findImport(ctx.importSpecifiers, specImport);
      if (paths.length > 0) {
        hasStrongSignal = true;
        evidenceList.push(
          evidence(
            "source-import",
            `Import of '${specImport}' found`,
            0.35,
            paths[0],
            `${paths.length} file(s)`,
          ),
        );
      }
    }

    for (const init of spec.initFiles) {
      if (!hasPath(ctx, init.path)) {
        continue;
      }

      // Generic init paths (i18n.ts, messages/) only reinforce existing signals.
      if (init.generic && !hasStrongSignal) {
        continue;
      }

      // Library-specific configs can stand alone.
      if (!init.generic) {
        hasStrongSignal = true;
      }

      evidenceList.push(
        evidence(
          init.directory ? "directory" : "config-file",
          init.directory
            ? `Found i18n path ${init.path}/`
            : `Found i18n init/config path ${init.path}`,
          init.generic ? 0.15 : 0.3,
          signalExample(ctx.pathIndex, init.path) ?? init.path,
        ),
      );
    }

    // Providers/APIs only count when the library is already indicated —
    // avoids shared names like useTranslation / useI18n / I18nProvider.
    if (hasStrongSignal) {
      for (const provider of spec.providers) {
        if (ctx.sourceIdentifiers.has(provider)) {
          evidenceList.push(
            evidence(
              "source-pattern",
              `Provider/API identifier '${provider}' referenced in source`,
              0.25,
              undefined,
              provider,
            ),
          );
        }
      }
    }

    if (evidenceList.length === 0) {
      continue;
    }

    items.push(
      buildDetectedItem(spec.id, spec.name, evidenceList) as DetectedI18nLibrary,
    );
  }

  const filtered = filterByMinConfidence(items, minConfidence);
  const adjusted = applyI18nSoftRules(filtered).sort(
    (a, b) => b.confidence - a.confidence,
  );

  if (adjusted.length === 0) {
    unknowns.push({
      category: "i18n-library",
      message:
        "No known localization library detected. Checked package.json, imports, init files, and common providers.",
    });
  } else if (adjusted.length > 1) {
    unknowns.push({
      category: "i18n-library",
      message: `Multiple localization libraries detected: ${adjusted
        .map((l) => l.id)
        .join(", ")}. Primary pick uses highest confidence.`,
      detail: adjusted.map((l) => `${l.id}=${l.confidence}`).join(", "),
    });
  }

  return { items: adjusted, unknowns };
}

function applyI18nSoftRules(
  items: DetectedI18nLibrary[],
): DetectedI18nLibrary[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const strong = (id: DetectedI18nLibrary["id"], min = 0.45): boolean =>
    (byId.get(id)?.confidence ?? 0) >= min;

  return items.map((item) => {
    if (
      item.id === "i18next" &&
      (strong("react-i18next") || strong("next-i18next"))
    ) {
      return demote(
        item,
        0.45,
        "i18next detected as core dependency of a higher-level i18n binding",
      );
    }
    if (item.id === "formatjs" && strong("react-intl")) {
      return demote(
        item,
        0.4,
        "FormatJS tooling/runtime often accompanies react-intl",
      );
    }
    if (item.id === "vue-i18n" && strong("nuxt-i18n")) {
      return demote(item, 0.45, "vue-i18n often underlies @nuxtjs/i18n");
    }
    return item;
  });
}

function demote(
  item: DetectedI18nLibrary,
  maxConfidence: number,
  message: string,
): DetectedI18nLibrary {
  return {
    ...item,
    confidence: Math.min(item.confidence, maxConfidence),
    evidence: [...item.evidence, evidence("heuristic", message, 0.05)],
  };
}
