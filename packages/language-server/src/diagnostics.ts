/**
 * Analyzer findings → LSP diagnostics.
 *
 * Ranges come from the locations the existing analyzers already computed; this
 * module never parses source code. When a finding cannot be placed accurately
 * it is dropped rather than published against a misleading range.
 */

import type { CoverageFileLocation, CoverageResult } from "@i18n-doctor/coverage";
import type { FileLocation, Issue, IssueSeverity } from "@i18n-doctor/issues";
import type { TranslationUsage } from "@i18n-doctor/usages";
import {
  DIAGNOSTIC_CODES,
  DIAGNOSTIC_SOURCE,
  DiagnosticSeverity,
  DiagnosticTag,
  type Diagnostic,
  type DiagnosticCode,
  type DiagnosticData,
  type DiagnosticRelatedInformation,
  type DiagnosticSeverityValue,
  type Position,
  type Range,
} from "./protocol.js";
import { pathToUri, type PlatformId } from "./workspace.js";

/** Provides buffer text for exact range mapping, when the file is open. */
export interface TextProvider {
  (absolutePath: string): string | undefined;
}

export interface DiagnosticContext {
  readonly textOf?: TextProvider;
  readonly platform?: PlatformId;
}

/** A diagnostic together with the file it belongs to. */
export interface LocatedDiagnostic {
  readonly absolutePath: string;
  readonly diagnostic: Diagnostic;
}

/** Positional information shared by every analyzer location shape. */
interface SourceSpan {
  /** 1-based. */
  readonly line: number;
  /** 1-based. */
  readonly column: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  /** UTF-16 offsets into the file. */
  readonly start?: number;
  readonly end?: number;
}

function toLspSeverity(severity: IssueSeverity): DiagnosticSeverityValue {
  switch (severity) {
    case "error":
      return DiagnosticSeverity.Error;
    case "warning":
      return DiagnosticSeverity.Warning;
    case "info":
      return DiagnosticSeverity.Information;
  }
}

/**
 * Best available range for an analyzer location.
 *
 * Precedence: UTF-16 offsets (exact) → explicit end line/column → the key
 * literal located on the reported line. Returns undefined when none of these
 * can produce a trustworthy range.
 */
export function toRange(
  span: SourceSpan,
  options: {
    readonly text?: string | undefined;
    readonly key?: string | undefined;
  } = {},
): Range | undefined {
  const text = options.text;

  if (
    text !== undefined &&
    span.start !== undefined &&
    span.end !== undefined &&
    span.start >= 0 &&
    span.end >= span.start &&
    span.end <= text.length
  ) {
    return {
      start: positionAtOffset(text, span.start),
      end: positionAtOffset(text, span.end),
    };
  }

  if (!Number.isInteger(span.line) || span.line < 1) return undefined;
  if (!Number.isInteger(span.column) || span.column < 1) return undefined;

  const start: Position = { line: span.line - 1, character: span.column - 1 };

  if (
    span.endLine !== undefined &&
    span.endColumn !== undefined &&
    span.endLine >= span.line &&
    span.endColumn >= 1 &&
    !(span.endLine === span.line && span.endColumn < span.column)
  ) {
    const end: Position = {
      line: span.endLine - 1,
      character: span.endColumn - 1,
    };
    return clampRange({ start, end }, text);
  }

  // Only a start position: underline the key literal when we can see the line.
  if (text !== undefined && options.key) {
    const located = locateKeyOnLine(text, start, options.key);
    if (located) return located;
  }

  return clampRange(
    { start, end: { line: start.line, character: start.character + 1 } },
    text,
  );
}

/**
 * Converts an analyzer issue into a diagnostic.
 *
 * Messages are reworded for editor presentation; the analyzer's own wording is
 * preserved in `diagnostic.data.analyzerMessage`.
 */
export function issueToDiagnostic(
  issue: Issue,
  context: DiagnosticContext = {},
): LocatedDiagnostic | undefined {
  const absolutePath = issue.location.absolutePath;
  if (!absolutePath) return undefined;

  const text = context.textOf?.(absolutePath);
  // Definition-side findings (unused / duplicate) live on catalog keys; nested
  // dotted keys only appear as the leaf property name in the file.
  const keyForRange =
    issue.type === "unused-key" || issue.type === "duplicate-key"
      ? lastSegment(issue.key)
      : issue.key;
  const range = toRange(issue.location, { text, key: keyForRange });
  if (!range) return undefined;

  const code = ISSUE_TYPE_TO_CODE[issue.type];
  const namespace = issue.source.namespace ?? issue.location.namespace;
  const locale = issue.source.locale ?? issue.location.locale;
  const display = displayKey(issue.key, namespace);

  const data: DiagnosticData = {
    code,
    key: issue.key,
    ...(namespace !== undefined ? { namespace } : {}),
    ...(locale !== undefined ? { locale } : {}),
    analyzerMessage: issue.message,
    ...(issue.source.confidence !== undefined
      ? { confidence: issue.source.confidence }
      : {}),
  };

  const related = relatedInformation(
    issue.relatedLocations,
    relatedLabel(issue),
    context,
  );

  return {
    absolutePath,
    diagnostic: {
      range,
      severity: toLspSeverity(issue.severity),
      code,
      source: DIAGNOSTIC_SOURCE,
      message: issueMessage(issue, display),
      ...(issue.type === "unused-key"
        ? { tags: [DiagnosticTag.Unnecessary] }
        : {}),
      ...(related.length > 0 ? { relatedInformation: related } : {}),
      data,
    },
  };
}

const ISSUE_TYPE_TO_CODE: Readonly<Record<Issue["type"], DiagnosticCode>> = {
  "unused-key": DIAGNOSTIC_CODES.unusedKey,
  "missing-key": DIAGNOSTIC_CODES.missingKey,
  "duplicate-key": DIAGNOSTIC_CODES.duplicateKey,
};

function issueMessage(issue: Issue, display: string): string {
  switch (issue.type) {
    case "missing-key":
      return `Translation key "${display}" does not exist.`;
    case "unused-key":
      return `Unused translation key "${display}" — defined but never used.`;
    case "duplicate-key": {
      const count = issue.relatedLocations.length + 1;
      const locale = issue.source.locale
        ? ` in locale "${issue.source.locale}"`
        : "";
      return `Duplicate translation key "${display}" defined ${count} times${locale}.`;
    }
  }
}

function relatedLabel(issue: Issue): string {
  switch (issue.type) {
    case "missing-key":
      return "also used here";
    case "unused-key":
      return "also defined here";
    case "duplicate-key":
      return "duplicate definition";
  }
}

/**
 * Coverage findings → diagnostics on the base-locale definition site.
 *
 * One diagnostic per key that is absent from at least one compared locale, so
 * the developer sees the gap where the key is actually defined.
 */
export function coverageToDiagnostics(
  coverage: CoverageResult,
  context: DiagnosticContext = {},
): readonly LocatedDiagnostic[] {
  const out: LocatedDiagnostic[] = [];

  for (const key of coverage.missing) {
    if (key.missingLocales.length === 0) continue;
    const base =
      key.files.find((f) => f.locale === key.baseLocale) ?? key.files[0];
    if (!base?.absolutePath) continue;

    const located = coverageDiagnostic({
      location: base,
      code: DIAGNOSTIC_CODES.missingTranslation,
      severity: DiagnosticSeverity.Warning,
      key: key.key,
      ...(key.namespace !== undefined ? { namespace: key.namespace } : {}),
      message: `Translation key "${displayKey(key.key, key.namespace)}" is missing in ${formatLocales(key.missingLocales)}.`,
      ...(key.confidence !== undefined ? { confidence: key.confidence } : {}),
      context,
    });
    if (located) out.push(located);
  }

  for (const extra of coverage.extra) {
    for (const file of extra.files) {
      if (!file.absolutePath) continue;
      const located = coverageDiagnostic({
        location: file,
        code: DIAGNOSTIC_CODES.extraTranslation,
        severity: DiagnosticSeverity.Information,
        key: extra.key,
        ...(extra.namespace !== undefined ? { namespace: extra.namespace } : {}),
        message: `Translation key "${displayKey(extra.key, extra.namespace)}" is not defined in base locale "${extra.baseLocale}".`,
        ...(extra.confidence !== undefined
          ? { confidence: extra.confidence }
          : {}),
        context,
      });
      if (located) out.push(located);
    }
  }

  return out;
}

function coverageDiagnostic(input: {
  readonly location: CoverageFileLocation;
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverityValue;
  readonly key: string;
  readonly namespace?: string;
  readonly message: string;
  readonly confidence?: number;
  readonly context: DiagnosticContext;
}): LocatedDiagnostic | undefined {
  const absolutePath = input.location.absolutePath;
  const text = input.context.textOf?.(absolutePath);
  const range = toRange(input.location, { text, key: lastSegment(input.key) });
  if (!range) return undefined;

  return {
    absolutePath,
    diagnostic: {
      range,
      severity: input.severity,
      code: input.code,
      source: DIAGNOSTIC_SOURCE,
      message: input.message,
      data: {
        code: input.code,
        key: input.key,
        ...(input.namespace !== undefined ? { namespace: input.namespace } : {}),
        ...(input.location.locale !== undefined
          ? { locale: input.location.locale }
          : {}),
        ...(input.confidence !== undefined
          ? { confidence: input.confidence }
          : {}),
      },
    },
  };
}

/**
 * Usages whose namespace the analyzer could not resolve.
 *
 * Reported as information, not errors: the key may well exist, but
 * namespace-aware matching cannot confirm which namespace it belongs to.
 *
 * Only meaningful when the project actually uses namespaces — in a flat
 * project every i18next call is legitimately namespace-less, so passing an
 * empty `knownNamespaces` suppresses the rule entirely.
 */
export function namespaceToDiagnostics(
  usages: readonly TranslationUsage[],
  knownNamespaces: readonly string[],
  context: DiagnosticContext = {},
): readonly LocatedDiagnostic[] {
  if (knownNamespaces.length === 0) return [];

  const out: LocatedDiagnostic[] = [];
  for (const usage of usages) {
    if (usage.namespaceResolved !== false) continue;
    const absolutePath = usage.absolutePath;
    if (!absolutePath) continue;

    const text = context.textOf?.(absolutePath);
    const range = toRange(usage.location, { text, key: usage.key });
    if (!range) continue;

    out.push({
      absolutePath,
      diagnostic: {
        range,
        severity: DiagnosticSeverity.Information,
        code: DIAGNOSTIC_CODES.namespaceUnresolved,
        source: DIAGNOSTIC_SOURCE,
        message: `Cannot resolve the namespace for translation key "${usage.key}"; it may not match any translation source.`,
        data: {
          code: DIAGNOSTIC_CODES.namespaceUnresolved,
          key: usage.key,
          ...(usage.namespace !== undefined
            ? { namespace: usage.namespace }
            : {}),
          confidence: usage.confidence,
          ...(usage.evidence !== undefined
            ? { analyzerMessage: usage.evidence }
            : {}),
        },
      },
    });
  }
  return out;
}

/** Namespace-qualified key, matching the analyzer's `namespace:key` model. */
export function displayKey(key: string, namespace?: string): string {
  if (!namespace || key.startsWith(`${namespace}:`)) {
    return key;
  }
  return `${namespace}:${key}`;
}

function formatLocales(locales: readonly string[]): string {
  const quoted = locales.map((l) => `"${l}"`);
  if (quoted.length === 1) return `locale ${quoted[0]}`;
  return `locales ${quoted.join(", ")}`;
}

function lastSegment(key: string): string {
  const parts = key.split(".");
  return parts[parts.length - 1] ?? key;
}

function relatedInformation(
  locations: readonly FileLocation[],
  message: string,
  context: DiagnosticContext,
): readonly DiagnosticRelatedInformation[] {
  const out: DiagnosticRelatedInformation[] = [];
  for (const location of locations) {
    if (!location.absolutePath) continue;
    const text = context.textOf?.(location.absolutePath);
    const range = toRange(location, { text });
    if (!range) continue;
    out.push({
      location: {
        uri: pathToUri(location.absolutePath, context.platform),
        range,
      },
      message,
    });
  }
  return out;
}

/** Zero-based position for a UTF-16 offset. Counts newlines only. */
export function positionAtOffset(text: string, offset: number): Position {
  const bounded = Math.max(0, Math.min(offset, text.length));
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < bounded; i += 1) {
    const ch = text.charCodeAt(i);
    if (ch === 10 /* \n */) {
      line += 1;
      lineStart = i + 1;
    } else if (ch === 13 /* \r */) {
      // Treat \r\n as one break; a lone \r also ends the line.
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

function locateKeyOnLine(
  text: string,
  start: Position,
  key: string,
): Range | undefined {
  const lines = text.split(/\r\n|\r|\n/);
  const line = lines[start.line];
  if (line === undefined) return undefined;

  const from = Math.max(0, Math.min(start.character, line.length));
  const index = line.indexOf(key, from);
  if (index === -1) return undefined;
  return {
    start: { line: start.line, character: index },
    end: { line: start.line, character: index + key.length },
  };
}

/** Keeps a range inside the document so clients never receive bad positions. */
function clampRange(r: Range, text: string | undefined): Range {
  if (text === undefined) return r;
  const lines = text.split(/\r\n|\r|\n/);
  const lastLine = Math.max(0, lines.length - 1);

  const clampPosition = (p: Position): Position => {
    const line = Math.max(0, Math.min(p.line, lastLine));
    const length = lines[line]?.length ?? 0;
    return { line, character: Math.max(0, Math.min(p.character, length)) };
  };

  const start = clampPosition(r.start);
  const end = clampPosition(r.end);
  if (end.line < start.line) return { start, end: start };
  if (end.line === start.line && end.character < start.character) {
    return { start, end: start };
  }
  return { start, end };
}
