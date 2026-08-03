/**
 * Extract Vue SFC regions with absolute offsets.
 * Template extraction is nesting-aware (`<template #slot>` inside root).
 */

export function extractVueTemplate(
  sourceText: string,
): { text: string; offset: number } | undefined {
  const openRe = /<template\b[^>]*>/i;
  const open = openRe.exec(sourceText);
  if (!open || open.index === undefined) {
    return undefined;
  }
  const contentStart = open.index + open[0].length;
  let depth = 1;
  let i = contentStart;
  const tokenRe = /<\/?template\b[^>]*>/gi;
  tokenRe.lastIndex = contentStart;
  let token: RegExpExecArray | null;
  while ((token = tokenRe.exec(sourceText))) {
    const raw = token[0];
    const isClose = raw.startsWith("</");
    // Self-closing <template … /> does not change depth.
    if (!isClose && /\/\s*>$/.test(raw)) {
      continue;
    }
    if (isClose) {
      depth -= 1;
      if (depth === 0) {
        return {
          text: sourceText.slice(contentStart, token.index),
          offset: contentStart,
        };
      }
    } else {
      depth += 1;
    }
    i = token.index + raw.length;
  }
  // Unclosed template — return best-effort remainder (caller may still find keys).
  void i;
  return {
    text: sourceText.slice(contentStart),
    offset: contentStart,
  };
}

export interface VueScriptSlice {
  readonly text: string;
  readonly offset: number;
  readonly lang: "ts" | "js" | "tsx" | "jsx";
  readonly setup: boolean;
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
    const setup = /\bsetup\b/i.test(attrs);
    scripts.push({ text: inner, offset, lang, setup });
  }
  return scripts;
}
