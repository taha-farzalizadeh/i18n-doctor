import type { DetectedPackageManager, UnknownConfiguration } from "../api/types.js";
import { PACKAGE_MANAGER_LOCKFILES } from "./catalogs.js";
import {
  buildDetectedItem,
  evidence,
  filterByMinConfidence,
} from "./evidence.js";
import { hasPath, type DetectionContext } from "./context.js";
import { signalExample } from "./path-index.js";

export function detectPackageManagers(
  ctx: DetectionContext,
  minConfidence: number,
): {
  items: DetectedPackageManager[];
  unknowns: UnknownConfiguration[];
} {
  const unknowns: UnknownConfiguration[] = [];
  const items: DetectedPackageManager[] = [];

  for (const pm of PACKAGE_MANAGER_LOCKFILES) {
    const evidenceList = [];
    const lockFiles = new Set(pm.lockFiles ?? pm.files.filter((f) => f.includes("lock")));

    for (const file of pm.files) {
      if (hasPath(ctx, file) || ctx.presentPaths.has(file)) {
        const isLock = lockFiles.has(file);
        evidenceList.push(
          evidence(
            "lockfile",
            `Found ${file}`,
            isLock ? pm.weight : pm.weight * 0.45,
            signalExample(ctx.pathIndex, file) ?? file,
          ),
        );
      }
    }

    for (const pkg of ctx.packageJsons) {
      if (!pkg.packageManager) {
        continue;
      }
      // Corepack: "pnpm@9.0.0", "yarn@1.22.22", "npm@10.0.0", "bun@1.1.0"
      const id = pkg.packageManager.split("@")[0]?.toLowerCase();
      if (id === pm.id) {
        evidenceList.push(
          evidence(
            "dependency",
            `package.json packageManager field specifies ${pkg.packageManager}`,
            0.75,
            pkg.path,
            pkg.packageManager,
          ),
        );
      }
    }

    if (evidenceList.length > 0) {
      items.push(
        buildDetectedItem(pm.id, pm.name, evidenceList) as DetectedPackageManager,
      );
    }
  }

  const filtered = filterByMinConfidence(items, minConfidence).sort(
    (a, b) => b.confidence - a.confidence,
  );

  if (filtered.length === 0) {
    unknowns.push({
      category: "package-manager",
      message:
        "No package manager lockfile detected (npm/pnpm/yarn/bun). Install dependencies or commit a lockfile for higher confidence.",
    });
  } else if (filtered.length > 1) {
    unknowns.push({
      category: "package-manager",
      message: `Multiple package manager signals found: ${filtered
        .map((p) => p.id)
        .join(", ")}. Primary pick uses highest confidence.`,
      detail: filtered.map((p) => `${p.id}=${p.confidence}`).join(", "),
    });
  }

  return { items: filtered, unknowns };
}
