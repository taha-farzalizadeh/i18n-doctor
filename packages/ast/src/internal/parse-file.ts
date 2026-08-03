import ts from "typescript";
import type { ParsedFile, ParseInput } from "../api/types.js";
import { buildContentKey } from "./cache.js";
import {
  engineDiagnostic,
  extractParseDiagnostics,
  hasErrorDiagnostics,
} from "./diagnostics.js";
import { resolveScriptMeta } from "./script-kind.js";

export interface ParseFileOptions {
  readonly target: ts.ScriptTarget;
  readonly setParentNodes: boolean;
  readonly retainSourceText: boolean;
}

export function parseSourceFile(
  input: ParseInput,
  options: ParseFileOptions,
  fromCache = false,
): ParsedFile {
  const fileId = input.fileId ?? input.fileName;

  if (typeof input.sourceText !== "string") {
    const sourceFile = ts.createSourceFile(
      input.fileName,
      "",
      options.target,
      options.setParentNodes,
      ts.ScriptKind.TS,
    );
    const diagnostic = engineDiagnostic(
      fileId,
      input.fileName,
      "ParseInput.sourceText must be a string",
      100001,
    );
    return {
      fileId,
      fileName: input.fileName,
      language: "typescript",
      jsx: "none",
      scriptKind: ts.ScriptKind.TS,
      sourceText: "",
      sourceFile,
      diagnostics: [diagnostic],
      ok: false,
      contentKey: buildContentKey(fileId, input.fileName, ""),
      parsedAt: new Date().toISOString(),
      fromCache,
    };
  }

  const meta = resolveScriptMeta(input);
  const contentKey = buildContentKey(
    fileId,
    input.fileName,
    input.sourceText,
    input.contentHash,
    input.mtimeMs,
  );

  // ScriptKind selects JS/JSX/TS/TSX; setParentNodes preserves parent links.
  const sourceFile = ts.createSourceFile(
    input.fileName,
    input.sourceText,
    options.target,
    options.setParentNodes,
    meta.scriptKind,
  );

  const diagnostics = extractParseDiagnostics(sourceFile, fileId);

  // Prefer SourceFile.text reference to avoid retaining two distinct strings.
  const sourceText = options.retainSourceText ? sourceFile.text : "";

  return {
    fileId,
    fileName: input.fileName,
    language: meta.language,
    jsx: meta.jsx,
    scriptKind: meta.scriptKind,
    sourceText,
    sourceFile,
    diagnostics,
    ok: !hasErrorDiagnostics(diagnostics),
    contentKey,
    parsedAt: new Date().toISOString(),
    fromCache,
  };
}
