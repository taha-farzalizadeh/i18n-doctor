/**
 * Resolve a cached translation usage (or dynamic site) under an LSP position.
 * Positions are 0-based (LSP); usage locations are 1-based.
 */

import type {
  DynamicTranslationUsage,
  TranslationUsage,
  UsageCatalog,
} from "@i18n-doctor/usages";

export interface LspPosition {
  readonly line: number;
  readonly character: number;
}

export type UsageAtPosition =
  | { readonly kind: "static"; readonly usage: TranslationUsage }
  | { readonly kind: "dynamic"; readonly usage: DynamicTranslationUsage }
  | { readonly kind: "none" };

function containsPosition(
  location: {
    readonly line: number;
    readonly column: number;
    readonly endLine: number;
    readonly endColumn: number;
  },
  position: LspPosition,
): boolean {
  const line = position.line + 1;
  const character = position.character + 1;
  if (line < location.line || line > location.endLine) return false;
  if (line === location.line && character < location.column) return false;
  if (line === location.endLine && character > location.endColumn) return false;
  return true;
}

export function findUsageAtPosition(
  catalog: UsageCatalog | undefined,
  absolutePath: string,
  position: LspPosition,
  pathEquals: (a: string, b: string) => boolean,
): UsageAtPosition {
  if (!catalog) return { kind: "none" };

  // Prefer dynamic sites: a call like `t("auth." + suffix)` must not get a
  // fabricated static definition/completion from a partial fragment.
  for (const usage of catalog.dynamicUsages ?? []) {
    if (!pathEquals(usage.absolutePath, absolutePath)) continue;
    if (containsPosition(usage.location, position)) {
      return { kind: "dynamic", usage };
    }
  }

  for (const usage of catalog.usages) {
    if (!pathEquals(usage.absolutePath, absolutePath)) continue;
    if (containsPosition(usage.location, position)) {
      return { kind: "static", usage };
    }
  }

  return { kind: "none" };
}

/**
 * Best-effort: detect a translation-call string literal around the cursor
 * when the usage catalog has not yet recorded an empty/partial key.
 */
export function translationKeyContextAt(
  text: string,
  offset: number,
): { readonly prefix: string; readonly inKeyLiteral: boolean } | null {
  if (offset < 0 || offset > text.length) return null;

  // Walk back to find an opening quote for the current string.
  let i = offset - 1;
  let quote: "'" | '"' | "`" | null = null;
  while (i >= 0) {
    const ch = text[i]!;
    if (ch === "\n") return null;
    if ((ch === "'" || ch === '"' || ch === "`") && !isEscaped(text, i)) {
      quote = ch;
      break;
    }
    i -= 1;
  }
  if (!quote) return null;

  const openQuote = i;
  const prefix = text.slice(openQuote + 1, offset);

  // Look back from the opening quote for t( / tx( / .t(
  const before = text.slice(Math.max(0, openQuote - 40), openQuote);
  if (!/(?:\b(?:t|tx)\s*|[\w$]\.t\s*)\(\s*$/.test(before)) {
    return null;
  }

  // Ensure we haven't already closed the string before the cursor.
  let closeQuote = -1;
  for (let j = openQuote + 1; j < text.length; j += 1) {
    const ch = text[j]!;
    if (ch === "\n") break;
    if (ch === quote && !isEscaped(text, j)) {
      closeQuote = j;
      break;
    }
  }
  if (closeQuote !== -1 && offset > closeQuote) return null;

  // Reject concatenations / template fragments: `t("auth." + x)` is dynamic.
  if (closeQuote !== -1) {
    const after = text.slice(closeQuote + 1, closeQuote + 12).trimStart();
    if (after.startsWith("+") || after.startsWith("`") || after.startsWith(")")) {
      // `)` is fine (static); `+` means dynamic.
      if (after.startsWith("+")) return null;
    }
  }

  return { prefix, inKeyLiteral: true };
}

function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) slashes += 1;
  return slashes % 2 === 1;
}

/** UTF-16 offset for an LSP position in document text. */
export function offsetAt(text: string, position: LspPosition): number {
  const lines = text.split(/\r\n|\r|\n/);
  let offset = 0;
  for (let line = 0; line < position.line; line += 1) {
    offset += (lines[line] ?? "").length;
    // Account for the newline that was split out (approximate \n).
    if (line < lines.length - 1) {
      const slice = text.slice(offset);
      if (slice.startsWith("\r\n")) offset += 2;
      else offset += 1;
    }
  }
  return offset + position.character;
}
