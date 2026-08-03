import { createAstEngine } from "@i18n-unused/ast";
import type { ResolutionResult } from "../src/index.js";
import { createLocalResolver } from "../src/index.js";
import { locationSpan } from "../src/internal/location.js";

const engine = createAstEngine({ cache: false });

export function analyzeSource(source: string, fileName = "sample.tsx") {
  const parsed = engine.parse({ fileName, sourceText: source });
  const resolver = createLocalResolver();
  const analysis = resolver.analyze({
    sourceFile: parsed.sourceFile,
    fileName,
  });
  return { resolver, analysis, sourceFile: parsed.sourceFile, source };
}

export function resolveCallNamed(
  source: string,
  callee: string,
  occurrence = 0,
): ResolutionResult {
  const { resolver, analysis, sourceFile } = analyzeSource(source);
  const text = sourceFile.text;
  const re = new RegExp(`\\b${escapeRegExp(callee)}\\s*\\(`, "g");
  let match: RegExpExecArray | null;
  let index = 0;
  let pos = -1;
  while ((match = re.exec(text)) !== null) {
    if (index === occurrence) {
      pos = match.index;
      break;
    }
    index += 1;
  }
  if (pos < 0) {
    throw new Error(`Call ${callee}(... ) occurrence ${occurrence} not found`);
  }
  return resolver.resolve({
    analysis,
    name: callee,
    position: pos,
    location: locationSpan(sourceFile, pos, pos + callee.length),
  });
}

/**
 * Resolve the last non-hook call in the source (skips wrapper body seeds).
 */
export function resolveFirstCall(source: string): ResolutionResult {
  const { resolver, analysis, sourceFile } = analyzeSource(source);
  const text = sourceFile.text;
  const skip = new Set([
    "useTranslation",
    "useTranslations",
    "useI18n",
    "require",
    "t",
    "i18n",
    "i18next",
  ]);
  const re = /\b([A-Za-z_$][\w$]*)\s*\(/g;
  let chosen: { name: string; index: number } | undefined;
  for (const m of text.matchAll(re)) {
    const n = m[1]!;
    if (skip.has(n)) {
      continue;
    }
    chosen = { name: n, index: m.index };
  }
  if (!chosen) {
    throw new Error("No resolvable call expression found");
  }
  return resolver.resolve({
    analysis,
    name: chosen.name,
    position: chosen.index,
    location: locationSpan(
      sourceFile,
      chosen.index,
      chosen.index + chosen.name.length,
    ),
  });
}

export function chainIds(result: ResolutionResult): string[] {
  return result.aliasChain.map((s) => s.identifier);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
