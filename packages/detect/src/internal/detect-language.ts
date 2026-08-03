import type { DetectedLanguage, UnknownConfiguration } from "../api/types.js";
import {
  buildDetectedItem,
  evidence,
  filterByMinConfidence,
} from "./evidence.js";
import { hasDependency, type DetectionContext } from "./context.js";

export function detectLanguages(
  ctx: DetectionContext,
  minConfidence: number,
): {
  items: DetectedLanguage[];
  unknowns: UnknownConfiguration[];
} {
  const unknowns: UnknownConfiguration[] = [];
  let jsFiles = 0;
  let tsFiles = 0;

  for (const file of ctx.snapshot.files()) {
    if (file.relativePath.endsWith(".d.ts")) {
      continue;
    }
    if (
      file.extension === "js" ||
      file.extension === "jsx" ||
      file.extension === "mjs" ||
      file.extension === "cjs"
    ) {
      jsFiles += 1;
    } else if (
      file.extension === "ts" ||
      file.extension === "tsx" ||
      file.extension === "mts" ||
      file.extension === "cts"
    ) {
      tsFiles += 1;
    }
  }

  const items: DetectedLanguage[] = [];

  const tsEvidence = [];
  if (tsFiles > 0) {
    tsEvidence.push(
      evidence(
        "heuristic",
        `Found ${tsFiles} TypeScript source file(s)`,
        Math.min(0.7, 0.25 + tsFiles / 200),
      ),
    );
  }
  for (const signal of ctx.pathIndex.signals) {
    if (
      signal === "tsconfig.json" ||
      signal === "tsconfig.base.json" ||
      /^tsconfig\.[^/]+\.json$/.test(signal)
    ) {
      tsEvidence.push(evidence("tsconfig", `Found ${signal}`, 0.35, signal));
      break;
    }
  }
  const typescriptPkg = hasDependency(ctx.packageJsons, "typescript", "any");
  if (typescriptPkg.found) {
    tsEvidence.push(
      evidence(
        "devDependency",
        "package.json lists typescript",
        0.25,
        typescriptPkg.path,
      ),
    );
  }
  if (tsEvidence.length > 0) {
    items.push(
      buildDetectedItem("typescript", "TypeScript", tsEvidence) as DetectedLanguage,
    );
  }

  const jsEvidence = [];
  if (jsFiles > 0) {
    jsEvidence.push(
      evidence(
        "heuristic",
        `Found ${jsFiles} JavaScript source file(s)`,
        Math.min(0.7, 0.25 + jsFiles / 200),
      ),
    );
  }
  if (ctx.pathIndex.signals.has("jsconfig.json") || ctx.presentPaths.has("jsconfig.json")) {
    jsEvidence.push(
      evidence("config-file", "Found jsconfig.json", 0.3, "jsconfig.json"),
    );
  }
  if (jsEvidence.length > 0) {
    items.push(
      buildDetectedItem("javascript", "JavaScript", jsEvidence) as DetectedLanguage,
    );
  }

  if (jsFiles > 0 && tsFiles > 0) {
    items.push(
      buildDetectedItem("mixed", "Mixed JavaScript/TypeScript", [
        evidence(
          "heuristic",
          `Project contains both JS (${jsFiles}) and TS (${tsFiles}) sources`,
          0.9,
        ),
      ]) as DetectedLanguage,
    );
  }

  const filtered = filterByMinConfidence(items, minConfidence).sort(
    (a, b) => b.confidence - a.confidence,
  );

  if (filtered.length === 0) {
    unknowns.push({
      category: "language",
      message:
        "Could not determine JavaScript/TypeScript usage. No matching source files or tsconfig were found.",
    });
  }

  return { items: filtered, unknowns };
}
