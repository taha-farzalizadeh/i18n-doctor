import type { LiteFileEntry } from "@i18n-unused/scanner";
import { isI18nPathContext, looksLikeLocale } from "./locale.js";

const SOURCE_DIR_RE =
  /(^|\/)(locales?|i18n|langs?|languages|messages|translations)(\/|$)/i;

const SOURCE_FILE_RE =
  /(^|\/)(i18n|locale|locales|messages|translations|translation)(\.[a-z0-9_-]+)?\.(json|ya?ml|jsx?|tsx?|mjs|cjs|mts|cts)$/i;

const GENERATED_SEGMENT_RE =
  /(^|\/)(\.next|\.nuxt|\.output|dist|build|out|coverage|generated|__generated__|\.turbo)(\/|$)/i;

const SCRIPT_EXT = new Set([
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "mts",
  "cts",
]);
const DATA_EXT = new Set(["json", "yaml", "yml"]);

export interface SourceCandidate {
  readonly file: LiteFileEntry;
  readonly score: number;
  readonly reasons: readonly string[];
}

export function isExtractableFile(file: LiteFileEntry): boolean {
  if (file.relativePath.endsWith(".d.ts")) {
    return false;
  }
  if (file.role === "generated") {
    return false;
  }
  if (GENERATED_SEGMENT_RE.test(file.relativePath)) {
    return false;
  }
  const base = file.relativePath.split("/").pop() ?? "";
  if (base === "package.json" || base === "tsconfig.json" || base === "jsconfig.json") {
    return false;
  }
  return DATA_EXT.has(file.extension) || SCRIPT_EXT.has(file.extension);
}

export function scoreCandidate(file: LiteFileEntry): SourceCandidate | undefined {
  if (!isExtractableFile(file)) {
    return undefined;
  }
  const path = file.relativePath;
  let score = 0;
  const reasons: string[] = [];

  if (SOURCE_DIR_RE.test(path) || isI18nPathContext(path)) {
    score += 50;
    reasons.push("path contains locales/i18n/messages directory");
  }
  if (SOURCE_FILE_RE.test(path)) {
    score += 40;
    reasons.push("filename matches i18n/messages pattern");
  }

  if (DATA_EXT.has(file.extension)) {
    const base = path.split("/").pop() ?? "";
    const stem = base.replace(/\.(json|ya?ml)$/i, "");
    const mode = isI18nPathContext(path) ? "loose" : "strict";
    if (looksLikeLocale(stem, mode)) {
      score += 35;
      reasons.push("filename looks like a locale resource");
    } else {
      const dotted = stem.split(".");
      const maybeLocale = dotted[dotted.length - 1];
      if (maybeLocale && looksLikeLocale(maybeLocale, mode)) {
        score += 30;
        reasons.push("filename contains locale segment");
      }
    }
  }

  if (DATA_EXT.has(file.extension) && score > 0) {
    score += 10;
    reasons.push("data format (json/yaml)");
  }
  if (SCRIPT_EXT.has(file.extension) && score > 0) {
    score += 5;
    reasons.push("script resource module");
  }

  // Weak fallback for json under public/locales-style only (not all public/)
  if (
    score === 0 &&
    DATA_EXT.has(file.extension) &&
    /(^|\/)public\/(locales?|messages|i18n)\//i.test(path)
  ) {
    score += 45;
    reasons.push("json/yaml under public locales/messages");
  }

  if (score < 15) {
    return undefined;
  }

  return { file, score, reasons };
}

export function selectCandidates(
  files: Iterable<LiteFileEntry>,
  max: number,
): SourceCandidate[] {
  const scored: SourceCandidate[] = [];
  for (const file of files) {
    const candidate = scoreCandidate(file);
    if (candidate) {
      scored.push(candidate);
    }
  }
  scored.sort(
    (a, b) =>
      b.score - a.score || a.file.relativePath.localeCompare(b.file.relativePath),
  );
  return scored.slice(0, max);
}
