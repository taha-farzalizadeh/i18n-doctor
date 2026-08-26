/**
 * Transport-independent LSP value objects.
 *
 * These are structurally identical to the `vscode-languageserver-types`
 * definitions, declared locally so the analyzer adapter and its tests never
 * need an editor or a live JSON-RPC connection.
 */

export const DIAGNOSTIC_SOURCE = "i18n-doctor";

/** LSP `DiagnosticSeverity` (1-based, per specification). */
export const DiagnosticSeverity = {
  Error: 1,
  Warning: 2,
  Information: 3,
  Hint: 4,
} as const;

export type DiagnosticSeverityValue =
  (typeof DiagnosticSeverity)[keyof typeof DiagnosticSeverity];

export const DiagnosticTag = {
  Unnecessary: 1,
  Deprecated: 2,
} as const;

export type DiagnosticTagValue =
  (typeof DiagnosticTag)[keyof typeof DiagnosticTag];

/** Zero-based line, UTF-16 character offset within the line. */
export interface Position {
  readonly line: number;
  readonly character: number;
}

export interface Range {
  readonly start: Position;
  readonly end: Position;
}

export interface Location {
  readonly uri: string;
  readonly range: Range;
}

export interface DiagnosticRelatedInformation {
  readonly location: Location;
  readonly message: string;
}

/**
 * Diagnostic codes owned by this server.
 *
 * Every code maps 1:1 onto a finding the existing analyzer already produces;
 * no new i18n rules are introduced here.
 */
export const DIAGNOSTIC_CODES = {
  /** @i18n-doctor/issues — `unused-key` */
  unusedKey: "unused-key",
  /** @i18n-doctor/issues — `missing-key` */
  missingKey: "missing-key",
  /** @i18n-doctor/issues — `duplicate-key` */
  duplicateKey: "duplicate-key",
  /** @i18n-doctor/issues — `untranslated-text` */
  untranslatedText: "untranslated-text",
  /** @i18n-doctor/coverage — `missing-translation` */
  missingTranslation: "missing-translation",
  /** @i18n-doctor/coverage — `extra-translation` */
  extraTranslation: "extra-translation",
  /** @i18n-doctor/usages — `namespaceResolved === false` */
  namespaceUnresolved: "namespace-unresolved",
} as const;

export type DiagnosticCode =
  (typeof DIAGNOSTIC_CODES)[keyof typeof DIAGNOSTIC_CODES];

/** Structured payload carried on every diagnostic for downstream clients. */
export interface DiagnosticData {
  readonly code: DiagnosticCode;
  readonly key: string;
  readonly namespace?: string;
  readonly locale?: string;
  /** Verbatim message from the analyzer, before editor-oriented rewording. */
  readonly analyzerMessage?: string;
  readonly confidence?: number;
}

export interface Diagnostic {
  readonly range: Range;
  readonly severity: DiagnosticSeverityValue;
  readonly code: DiagnosticCode;
  readonly source: typeof DIAGNOSTIC_SOURCE;
  readonly message: string;
  readonly tags?: readonly DiagnosticTagValue[];
  readonly relatedInformation?: readonly DiagnosticRelatedInformation[];
  readonly data?: DiagnosticData;
}

export interface PublishDiagnosticsParams {
  readonly uri: string;
  readonly version?: number;
  readonly diagnostics: readonly Diagnostic[];
}