import type { CoverageFileLocation, CoverageResult } from "@i18n-doctor/coverage";
import type { FileLocation, Issue } from "@i18n-doctor/issues";

/** Positional span shared by analyzer locations. */
export interface SourceSpan {
  /** 1-based line. */
  readonly line: number;
  /** 1-based column. */
  readonly column: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  /** UTF-16 offsets into the file. */
  readonly start?: number;
  readonly end?: number;
}

/** ESLint-compatible 1-based line, 0-based column range. */
export interface EslintSourceLocation {
  readonly start: { readonly line: number; readonly column: number };
  readonly end: { readonly line: number; readonly column: number };
}

export function displayKey(key: string, namespace?: string): string {
  if (!namespace || key.startsWith(`${namespace}:`)) {
    return key;
  }
  return `${namespace}:${key}`;
}

export function lastSegment(key: string): string {
  const parts = key.split(".");
  return parts[parts.length - 1] ?? key;
}

/** Zero-based position for a UTF-16 offset. Counts newlines only. */
export function positionAtOffset(
  text: string,
  offset: number,
): { readonly line: number; readonly character: number } {
  const bounded = Math.max(0, Math.min(offset, text.length));
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < bounded; i += 1) {
    const ch = text.charCodeAt(i);
    if (ch === 10 /* \n */) {
      line += 1;
      lineStart = i + 1;
    } else if (ch === 13 /* \r */) {
      if (text.charCodeAt(i + 1) === 10) {
        i += 1;
        if (i >= bounded) break;
      }
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, character: bounded - lineStart };
}

/**
 * Best available range for an analyzer location.
 *
 * Precedence: UTF-16 offsets → explicit end line/column → key literal on line.
 */
export function toEslintLocation(
  span: SourceSpan,
  options: {
    readonly text?: string | undefined;
    readonly key?: string | undefined;
  } = {},
): EslintSourceLocation | undefined {
  const text = options.text;

  if (
    text !== undefined &&
    span.start !== undefined &&
    span.end !== undefined &&
    span.start >= 0 &&
    span.end >= span.start &&
    span.end <= text.length
  ) {
    const start = positionAtOffset(text, span.start);
    const end = positionAtOffset(text, span.end);
    return toEslintLoc(start, end, text);
  }

  if (!Number.isInteger(span.line) || span.line < 1) return undefined;
  if (!Number.isInteger(span.column) || span.column < 1) return undefined;

  const startLine = span.line;
  const startColumn = span.column - 1;

  if (
    span.endLine !== undefined &&
    span.endColumn !== undefined &&
    span.endLine >= span.line &&
    span.endColumn >= 1 &&
    !(span.endLine === span.line && span.endColumn < span.column)
  ) {
    return clampEslintLoc(
      {
        start: { line: startLine, column: startColumn },
        end: { line: span.endLine, column: span.endColumn - 1 },
      },
      text,
    );
  }

  if (text !== undefined && options.key) {
    const located = locateKeyOnLine(text, startLine, startColumn, options.key);
    if (located) return located;
  }

  return clampEslintLoc(
    {
      start: { line: startLine, column: startColumn },
      end: { line: startLine, column: startColumn + 1 },
    },
    text,
  );
}

function toEslintLoc(
  start: { readonly line: number; readonly character: number },
  end: { readonly line: number; readonly character: number },
  text: string | undefined,
): EslintSourceLocation {
  return clampEslintLoc(
    {
      start: { line: start.line + 1, column: start.character },
      end: { line: end.line + 1, column: end.character },
    },
    text,
  );
}

function locateKeyOnLine(
  text: string,
  lineNumber: number,
  fromColumn: number,
  key: string,
): EslintSourceLocation | undefined {
  const lines = text.split(/\r\n|\r|\n/);
  const line = lines[lineNumber - 1];
  if (line === undefined) return undefined;

  const from = Math.max(0, Math.min(fromColumn, line.length));
  const index = line.indexOf(key, from);
  if (index === -1) {
    const fallback = line.indexOf(key);
    if (fallback === -1) return undefined;
    return {
      start: { line: lineNumber, column: fallback },
      end: { line: lineNumber, column: fallback + key.length },
    };
  }
  return {
    start: { line: lineNumber, column: index },
    end: { line: lineNumber, column: index + key.length },
  };
}

function clampEslintLoc(
  loc: EslintSourceLocation,
  text: string | undefined,
): EslintSourceLocation {
  if (text === undefined) return loc;
  const lines = text.split(/\r\n|\r|\n/);
  const lastLine = Math.max(1, lines.length);

  const clamp = (line: number, column: number) => {
    const clampedLine = Math.max(1, Math.min(line, lastLine));
    const length = lines[clampedLine - 1]?.length ?? 0;
    return {
      line: clampedLine,
      column: Math.max(0, Math.min(column, length)),
    };
  };

  const start = clamp(loc.start.line, loc.start.column);
  const end = clamp(loc.end.line, loc.end.column);
  if (end.line < start.line) return { start, end: start };
  if (end.line === start.line && end.column < start.column) {
    return { start, end: start };
  }
  return { start, end };
}

export function issueLocationToEslint(
  issue: Issue,
  text: string | undefined,
): EslintSourceLocation | undefined {
  const keyForRange =
    issue.type === "unused-key" || issue.type === "duplicate-key"
      ? lastSegment(issue.key)
      : issue.key;
  return toEslintLocation(issue.location, { text, key: keyForRange });
}

export function fileLocationToEslint(
  location: FileLocation | CoverageFileLocation,
  text: string | undefined,
  key: string,
): EslintSourceLocation | undefined {
  return toEslintLocation(location, {
    text,
    key: lastSegment(key),
  });
}
