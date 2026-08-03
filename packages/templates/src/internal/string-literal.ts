/**
 * Parse a JS/TS/HTML-expression string literal starting at `offset`.
 * Supports `'…'`, `"…"`, and basic escapes (`\\`, `\'`, `\"`, `\n`, `\t`, `\uXXXX`).
 * Backtick literals are accepted only when they contain no `${…}` interpolations.
 */

export interface ParsedStringLiteral {
  /** Unescaped string contents (the translation key). */
  readonly value: string;
  /** Absolute start of the key contents (after opening quote). */
  readonly contentStart: number;
  /** Absolute end of the key contents (before closing quote). */
  readonly contentEnd: number;
  /** Absolute end after closing quote. */
  readonly end: number;
}

export function parseStringLiteralAt(
  text: string,
  offset: number,
): ParsedStringLiteral | undefined {
  const quote = text[offset];
  if (quote !== "'" && quote !== '"' && quote !== "`") {
    return undefined;
  }

  let i = offset + 1;
  let value = "";
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === quote) {
      return {
        value,
        contentStart: offset + 1,
        contentEnd: i,
        end: i + 1,
      };
    }
    if (quote !== "`" && ch === "\n") {
      return undefined;
    }
    if (quote === "`" && ch === "$" && text[i + 1] === "{") {
      return undefined; // dynamic template
    }
    if (ch === "\\") {
      const next = text[i + 1];
      if (next === undefined) {
        return undefined;
      }
      const escaped = unescape(next, text, i + 1);
      if (!escaped) {
        return undefined;
      }
      value += escaped.char;
      i = escaped.nextIndex;
      continue;
    }
    value += ch;
    i += 1;
  }
  return undefined;
}

/** Skip whitespace from offset; return first non-ws index. */
export function skipWs(text: string, offset: number): number {
  let i = offset;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }
    break;
  }
  return i;
}

function unescape(
  next: string,
  text: string,
  nextIndex: number,
): { char: string; nextIndex: number } | undefined {
  switch (next) {
    case "n":
      return { char: "\n", nextIndex: nextIndex + 1 };
    case "r":
      return { char: "\r", nextIndex: nextIndex + 1 };
    case "t":
      return { char: "\t", nextIndex: nextIndex + 1 };
    case "\\":
    case "'":
    case '"':
    case "`":
      return { char: next, nextIndex: nextIndex + 1 };
    case "u": {
      const hex = text.slice(nextIndex + 1, nextIndex + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
        return undefined;
      }
      return {
        char: String.fromCharCode(Number.parseInt(hex, 16)),
        nextIndex: nextIndex + 5,
      };
    }
    default:
      return { char: next, nextIndex: nextIndex + 1 };
  }
}
