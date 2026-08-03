import ts from "typescript";
import type {
  AstDiagnostic,
  AstFileId,
  DiagnosticSeverity,
} from "../api/types.js";

/** SourceFile carries parseDiagnostics as an internal field after createSourceFile. */
interface SourceFileWithParseDiagnostics extends ts.SourceFile {
  parseDiagnostics?: readonly ts.DiagnosticWithLocation[] | readonly ts.Diagnostic[];
}

export function extractParseDiagnostics(
  sourceFile: ts.SourceFile,
  fileId: AstFileId,
): AstDiagnostic[] {
  const raw =
    (sourceFile as SourceFileWithParseDiagnostics).parseDiagnostics ?? [];

  if (raw.length === 0) {
    return [];
  }

  const out: AstDiagnostic[] = new Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    out[i] = toAstDiagnostic(raw[i]!, fileId, sourceFile, "parse");
  }
  return out;
}

export function engineDiagnostic(
  fileId: AstFileId,
  fileName: string,
  message: string,
  code = 0,
): AstDiagnostic {
  return {
    code,
    message,
    severity: "error",
    fileName,
    fileId,
    start: undefined,
    length: undefined,
    line: undefined,
    character: undefined,
    category: "engine",
  };
}

export function toAstDiagnostic(
  diagnostic: ts.Diagnostic,
  fileId: AstFileId,
  sourceFile: ts.SourceFile | undefined,
  category: AstDiagnostic["category"],
): AstDiagnostic {
  const fileName =
    diagnostic.file?.fileName ?? sourceFile?.fileName ?? fileId;

  let line: number | undefined;
  let character: number | undefined;
  const start = diagnostic.start;

  if (start !== undefined && start >= 0) {
    try {
      const file = diagnostic.file ?? sourceFile;
      if (file && start <= file.text.length) {
        const pos = file.getLineAndCharacterOfPosition(start);
        line = pos.line + 1;
        character = pos.character + 1;
      }
    } catch {
      // Malformed positions on recovery trees — leave line/character unset.
    }
  }

  return {
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    severity: mapCategory(diagnostic.category),
    fileName,
    fileId,
    start,
    length: diagnostic.length,
    line,
    character,
    category,
  };
}

function mapCategory(category: ts.DiagnosticCategory): DiagnosticSeverity {
  switch (category) {
    case ts.DiagnosticCategory.Error:
      return "error";
    case ts.DiagnosticCategory.Warning:
      return "warning";
    case ts.DiagnosticCategory.Suggestion:
      return "suggestion";
    case ts.DiagnosticCategory.Message:
      return "message";
    default:
      return "message";
  }
}

export function hasParseErrors(diagnostics: readonly AstDiagnostic[]): boolean {
  return hasErrorDiagnostics(diagnostics);
}

/** True when any error-severity diagnostic is present (parse or engine). */
export function hasErrorDiagnostics(
  diagnostics: readonly AstDiagnostic[],
): boolean {
  for (let i = 0; i < diagnostics.length; i += 1) {
    if (diagnostics[i]!.severity === "error") {
      return true;
    }
  }
  return false;
}
