import type {
  DetectedFramework,
  DetectionEvidence,
  NextRouterKind,
  UnknownConfiguration,
} from "../api/types.js";
import { FRAMEWORK_SPECS } from "./catalogs.js";
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

export function detectFrameworks(
  ctx: DetectionContext,
  minConfidence: number,
): {
  items: DetectedFramework[];
  unknowns: UnknownConfiguration[];
} {
  const unknowns: UnknownConfiguration[] = [];
  const items: DetectedFramework[] = [];

  for (const spec of FRAMEWORK_SPECS) {
    const evidenceList: DetectionEvidence[] = [];

    for (const pkg of spec.packages) {
      const hit = hasDependency(ctx.packageJsons, pkg.name, pkg.section ?? "any");
      if (hit.found) {
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

    for (const file of spec.configFiles) {
      if (hasPath(ctx, file)) {
        evidenceList.push(
          evidence(
            "config-file",
            `Found config ${file}`,
            0.35,
            signalExample(ctx.pathIndex, file) ?? file,
          ),
        );
      }
    }

    // Expo: only treat app.json as evidence when it contains an expo key.
    if (spec.id === "expo" && ctx.flags.expoManifest) {
      if (hasPath(ctx, "app.json") || ctx.pathIndex.present.has("app.json")) {
        evidenceList.push(
          evidence(
            "config-file",
            "Found Expo app.json manifest",
            0.35,
            signalExample(ctx.pathIndex, "app.json") ?? "app.json",
          ),
        );
      } else if (
        !spec.configFiles.some((f) => hasPath(ctx, f)) &&
        hasDependency(ctx.packageJsons, "expo").found
      ) {
        // package-only expo still valid; manifest flag may come from app.config.*
      }
    }

    for (const dir of spec.directories) {
      if (hasPath(ctx, dir)) {
        // CRA public/ alone is weak — only count with react-scripts or scripts.
        if (spec.id === "cra" && dir === "public") {
          const hasScripts = hasDependency(ctx.packageJsons, "react-scripts").found;
          const usesScript = ctx.packageJsons.some((p) =>
            Object.values(p.scripts).some((s) => s.includes("react-scripts")),
          );
          if (!hasScripts && !usesScript) {
            continue;
          }
        }
        evidenceList.push(
          evidence(
            "directory",
            `Found directory ${dir}/`,
            0.2,
            signalExample(ctx.pathIndex, dir) ?? dir,
          ),
        );
      }
    }

    for (const specImport of spec.imports) {
      const paths = findImport(ctx.importSpecifiers, specImport);
      if (paths.length > 0) {
        evidenceList.push(
          evidence(
            "source-import",
            `Import of '${specImport}' found`,
            0.3,
            paths[0],
            `${paths.length} file(s)`,
          ),
        );
      }
    }

    if (spec.id === "cra") {
      for (const pkg of ctx.packageJsons) {
        const scriptHit = Object.entries(pkg.scripts).find(([, value]) =>
          value.includes("react-scripts"),
        );
        if (scriptHit) {
          evidenceList.push(
            evidence(
              "heuristic",
              `npm script "${scriptHit[0]}" uses react-scripts`,
              0.35,
              pkg.path,
            ),
          );
        }
      }
    }

    if (evidenceList.length === 0) {
      continue;
    }

    const extra: { nextRouter?: NextRouterKind } = {};
    if (spec.id === "nextjs") {
      extra.nextRouter = detectNextRouter(ctx);
      if (extra.nextRouter === "app") {
        evidenceList.push(
          evidence(
            "directory",
            "Next.js App Router (app/)",
            0.25,
            signalExample(ctx.pathIndex, "src/app") ??
              signalExample(ctx.pathIndex, "app") ??
              "app",
          ),
        );
      } else if (extra.nextRouter === "pages") {
        evidenceList.push(
          evidence(
            "directory",
            "Next.js Pages Router (pages/)",
            0.25,
            signalExample(ctx.pathIndex, "src/pages") ??
              signalExample(ctx.pathIndex, "pages") ??
              "pages",
          ),
        );
      } else if (extra.nextRouter === "mixed") {
        evidenceList.push(
          evidence(
            "directory",
            "Both app/ and pages/ present (mixed Next router)",
            0.2,
          ),
        );
      }
    }

    items.push(
      buildDetectedItem(spec.id, spec.name, evidenceList, extra) as DetectedFramework,
    );
  }

  const filtered = filterByMinConfidence(items, minConfidence);
  const adjusted = applyFrameworkSoftRules(filtered);
  const sorted = adjusted.sort((a, b) => b.confidence - a.confidence);

  if (sorted.length === 0) {
    unknowns.push({
      category: "framework",
      message:
        "No known UI framework detected from dependencies, configs, or imports.",
    });
  }

  return { items: sorted, unknowns };
}

function applyFrameworkSoftRules(
  items: DetectedFramework[],
): DetectedFramework[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const strong = (id: DetectedFramework["id"], min = 0.5): boolean =>
    (byId.get(id)?.confidence ?? 0) >= min;

  return items.map((item) => {
    if (item.id === "react") {
      if (
        strong("nextjs") ||
        strong("expo") ||
        strong("cra") ||
        strong("react-native")
      ) {
        return demote(
          item,
          0.55,
          "React detected as base library under a meta-framework",
        );
      }
    }
    if (item.id === "react-native" && strong("expo")) {
      return demote(
        item,
        0.5,
        "React Native detected as runtime under Expo",
      );
    }
    if (item.id === "vue" && strong("nuxt")) {
      return demote(item, 0.5, "Vue detected as base library under Nuxt");
    }
    return item;
  });
}

function demote(
  item: DetectedFramework,
  maxConfidence: number,
  message: string,
): DetectedFramework {
  if (item.confidence <= maxConfidence) {
    return {
      ...item,
      evidence: [
        ...item.evidence,
        evidence("heuristic", message, 0.05),
      ],
    };
  }
  return {
    ...item,
    confidence: maxConfidence,
    evidence: [
      ...item.evidence,
      evidence("heuristic", message, 0.05),
    ],
  };
}

function detectNextRouter(ctx: DetectionContext): NextRouterKind {
  const app = hasPath(ctx, "app") || hasPath(ctx, "src/app");
  const pages = hasPath(ctx, "pages") || hasPath(ctx, "src/pages");

  if (app && pages) {
    return "mixed";
  }
  if (app) {
    return "app";
  }
  if (pages) {
    return "pages";
  }
  return "unknown";
}
