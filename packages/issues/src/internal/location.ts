import path from "node:path";
import { pathToFileURL } from "node:url";
import type { DefinitionFact, FileLocation, UsageFact } from "../api/types.js";

export function definitionToLocation(fact: DefinitionFact): FileLocation {
  return {
    absolutePath: fact.absolutePath,
    relativePath: toPosixPath(fact.relativePath),
    line: fact.line,
    column: fact.column,
    ...(fact.endLine !== undefined ? { endLine: fact.endLine } : {}),
    ...(fact.endColumn !== undefined ? { endColumn: fact.endColumn } : {}),
    ...(fact.start !== undefined ? { start: fact.start } : {}),
    ...(fact.end !== undefined ? { end: fact.end } : {}),
    ...(fact.locale !== undefined ? { locale: fact.locale } : {}),
    ...(fact.namespace !== undefined ? { namespace: fact.namespace } : {}),
  };
}

export function usageToLocation(fact: UsageFact): FileLocation {
  return {
    absolutePath: fact.absolutePath,
    relativePath: toPosixPath(fact.relativePath),
    line: fact.line,
    column: fact.column,
    ...(fact.endLine !== undefined ? { endLine: fact.endLine } : {}),
    ...(fact.endColumn !== undefined ? { endColumn: fact.endColumn } : {}),
    ...(fact.start !== undefined ? { start: fact.start } : {}),
    ...(fact.end !== undefined ? { end: fact.end } : {}),
    ...(fact.namespace !== undefined ? { namespace: fact.namespace } : {}),
  };
}

export function resolveAbsolute(root: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    return relativePath;
  }
  return path.resolve(root, relativePath);
}

/**
 * Clickable / copy-paste file locator.
 * Format: file:///absolute/path/file.ts:line:column
 */
export function toFileUrl(location: FileLocation): string {
  const base = toFileHref(location.absolutePath);
  return `${base}:${location.line}:${location.column}`;
}

/**
 * Valid `file:` URI for OSC-8 hyperlink targets (no line/column suffix).
 * Line/column in a URI path break many terminals' link openers.
 */
export function toFileHref(absolutePath: string): string {
  if (absolutePath.startsWith("file:")) {
    // Strip accidental :line:column if a full locator was passed.
    const stripped = absolutePath.replace(/:\d+:\d+$/, "");
    return stripped;
  }
  return pathToFileURL(absolutePath).href;
}

export function formatLocationLabel(location: FileLocation): string {
  return `${toPosixPath(location.relativePath)}:${location.line}:${location.column}`;
}

export function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}
