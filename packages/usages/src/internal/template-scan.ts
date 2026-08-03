import type { TranslationUsage, UsageLibraryId } from "../api/types.js";
import { locationFromOffsets } from "./location.js";
import { buildUsage } from "./usage-builder.js";

/**
 * Lightweight Vue / Angular template scans.
 * Not a full template AST — only static string patterns.
 * Comments are blanked (length-preserving) so offsets stay accurate.
 */

const COMMENT_RE = /<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

function stripComments(text: string): string {
  return text.replace(COMMENT_RE, (m) => " ".repeat(m.length));
}

/** Extract `<template>...</template>` body from an SFC, with absolute offset. */
export function extractVueTemplate(
  sourceText: string,
): { text: string; offset: number } | undefined {
  const match = /<template\b[^>]*>([\s\S]*?)<\/template>/i.exec(sourceText);
  if (!match || match.index === undefined) {
    return undefined;
  }
  const inner = match[1] ?? "";
  const offset = match.index + match[0].indexOf(inner);
  return { text: inner, offset };
}

export interface VueScriptSlice {
  readonly text: string;
  readonly offset: number;
  readonly lang: "ts" | "js" | "tsx" | "jsx";
}

/** Extract `<script>...</script>` bodies with absolute start offsets. */
export function extractVueScripts(sourceText: string): VueScriptSlice[] {
  const scripts: VueScriptSlice[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sourceText))) {
    const attrs = match[1] ?? "";
    const inner = match[2] ?? "";
    if (!inner.trim()) {
      continue;
    }
    const offset = match.index + match[0].indexOf(inner);
    const langAttr = /\blang\s*=\s*['"]([^'"]+)['"]/i.exec(attrs);
    const langRaw = (langAttr?.[1] ?? "js").toLowerCase();
    const lang =
      langRaw === "ts" || langRaw === "typescript"
        ? "ts"
        : langRaw === "tsx"
          ? "tsx"
          : langRaw === "jsx"
            ? "jsx"
            : "js";
    scripts.push({ text: inner, offset, lang });
  }
  return scripts;
}

export function scanVueTemplateUsages(input: {
  absolutePath: string;
  relativePath: string;
  sourceText: string;
}): TranslationUsage[] {
  const tpl = extractVueTemplate(input.sourceText);
  if (!tpl) {
    return [];
  }
  const text = stripComments(tpl.text);
  const usages: TranslationUsage[] = [];

  const patterns: Array<{
    re: RegExp;
    evidence: string;
    confidence: number;
  }> = [
    {
      re: /\$t\s*\(\s*(['"])([^'"\n]+)\1/g,
      evidence: "vue-template-detector: $t(...)",
      confidence: 0.8,
    },
    {
      re: /\bi18n\.t\s*\(\s*(['"])([^'"\n]+)\1/g,
      evidence: "vue-template-detector: i18n.t(...)",
      confidence: 0.8,
    },
  ];

  for (const pattern of patterns) {
    const re = new RegExp(pattern.re.source, pattern.re.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const key = m[2];
      if (!key) {
        continue;
      }
      const keyStartInTpl = m.index + m[0].lastIndexOf(key);
      const absStart = tpl.offset + keyStartInTpl;
      usages.push(
        buildUsage({
          key,
          absolutePath: input.absolutePath,
          relativePath: input.relativePath,
          location: locationFromOffsets(
            input.sourceText,
            absStart,
            absStart + key.length,
          ),
          library: "vue-i18n",
          confidence: pattern.confidence,
          context: "function-call",
          evidence: pattern.evidence,
        }),
      );
    }
  }

  return usages;
}

export function scanAngularTemplateUsages(input: {
  absolutePath: string;
  relativePath: string;
  sourceText: string;
  library?: UsageLibraryId;
}): TranslationUsage[] {
  const text = stripComments(input.sourceText);
  const usages: TranslationUsage[] = [];
  const library = input.library ?? "ngx-translate";

  // 'key' | translate   optionally followed by :args
  const pipeRe = /(['"])([^'"\n]+)\1\s*\|\s*translate\b/g;
  let m: RegExpExecArray | null;
  while ((m = pipeRe.exec(text))) {
    const key = m[2];
    if (!key) {
      continue;
    }
    const keyStart = m.index + 1;
    usages.push(
      buildUsage({
        key,
        absolutePath: input.absolutePath,
        relativePath: input.relativePath,
        location: locationFromOffsets(
          input.sourceText,
          keyStart,
          keyStart + key.length,
        ),
        library,
        confidence: 0.82,
        context: "pipe",
        evidence: "angular-template-detector: 'key' | translate",
      }),
    );
  }

  const translocoRe = /(['"])([^'"\n]+)\1\s*\|\s*transloco\b/g;
  while ((m = translocoRe.exec(text))) {
    const key = m[2];
    if (!key) {
      continue;
    }
    const keyStart = m.index + 1;
    usages.push(
      buildUsage({
        key,
        absolutePath: input.absolutePath,
        relativePath: input.relativePath,
        location: locationFromOffsets(
          input.sourceText,
          keyStart,
          keyStart + key.length,
        ),
        library: "transloco",
        confidence: 0.82,
        context: "pipe",
        evidence: "angular-template-detector: 'key' | transloco",
      }),
    );
  }

  return usages;
}
