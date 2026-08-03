import ts from "typescript";
import type { AstJsxMode, AstLanguage, ParseInput } from "../api/types.js";

export interface ResolvedScriptMeta {
  readonly language: AstLanguage;
  readonly jsx: AstJsxMode;
  readonly scriptKind: ts.ScriptKind;
}

export function resolveScriptMeta(input: ParseInput): ResolvedScriptMeta {
  const ext = extensionOf(input.fileName);
  const inferred = inferFromExtension(ext);

  const language = input.language ?? inferred.language;
  const jsx = input.jsx ?? inferred.jsx;
  const scriptKind = toScriptKind(language, jsx);

  return { language, jsx, scriptKind };
}

function inferFromExtension(ext: string): {
  language: AstLanguage;
  jsx: AstJsxMode;
} {
  switch (ext) {
    case "ts":
    case "mts":
    case "cts":
      return { language: "typescript", jsx: "none" };
    case "tsx":
      return { language: "typescript", jsx: "tsx" };
    case "jsx":
      return { language: "javascript", jsx: "jsx" };
    case "js":
    case "mjs":
    case "cjs":
      return { language: "javascript", jsx: "none" };
    default:
      // Prefer TS parse for unknown extensions (wider syntax acceptance).
      return { language: "typescript", jsx: "none" };
  }
}

function toScriptKind(language: AstLanguage, jsx: AstJsxMode): ts.ScriptKind {
  if (jsx === "tsx") {
    return ts.ScriptKind.TSX;
  }
  if (jsx === "jsx") {
    return ts.ScriptKind.JSX;
  }
  if (language === "javascript") {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function extensionOf(fileName: string): string {
  const normalized = fileName.replace(/\\/g, "/");
  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  const idx = base.lastIndexOf(".");
  if (idx <= 0) {
    return "";
  }
  return base.slice(idx + 1).toLowerCase();
}

export function isSupportedSourceFileName(fileName: string): boolean {
  const ext = extensionOf(fileName);
  return (
    ext === "js" ||
    ext === "jsx" ||
    ext === "ts" ||
    ext === "tsx" ||
    ext === "mjs" ||
    ext === "cjs" ||
    ext === "mts" ||
    ext === "cts"
  );
}
