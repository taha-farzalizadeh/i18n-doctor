import path from "node:path";
import type { AbsoluteOsPath, CasePolicy, RelativePosixPath, RootIdentity } from "./paths.js";
import { asAbsoluteOsPath, asRelativePosixPath } from "./brands.js";

const WINDOWS_DRIVE = /^[A-Za-z]:/;
const UNC = /^\\\\/;

/** Normalize an absolute OS path (resolve `.` / `..`, strip trailing separators). */
export function normalizeOsPath(osPath: string): AbsoluteOsPath {
  const normalized = path.resolve(osPath);
  if (normalized.length > 1 && (normalized.endsWith(path.sep) || normalized.endsWith("/"))) {
    return asAbsoluteOsPath(normalized.replace(/[/\\]+$/, ""));
  }
  return asAbsoluteOsPath(normalized);
}

export function createRootIdentity(osPath: AbsoluteOsPath): RootIdentity {
  const raw = String(osPath);
  // Detect Windows forms before host path.resolve rewrites them on POSIX.
  if (UNC.test(raw) || raw.startsWith("//")) {
    const normalized = asAbsoluteOsPath(raw.replace(/[/\\]+$/, ""));
    return { kind: "unc", osPath: normalized, digest: `unc:${normalized}` };
  }
  if (WINDOWS_DRIVE.test(raw)) {
    const normalized = asAbsoluteOsPath(raw.replace(/[/\\]+$/, ""));
    return {
      kind: "windows-drive",
      osPath: normalized,
      digest: `win:${normalized.toLowerCase()}`,
    };
  }
  const normalized = normalizeOsPath(osPath);
  return { kind: "posix", osPath: normalized, digest: `posix:${normalized}` };
}

/**
 * Convert an absolute OS path to a workspace-relative POSIX path.
 * Returns undefined when the path escapes the workspace root.
 */
export function toRelativePosix(
  root: AbsoluteOsPath,
  osPath: AbsoluteOsPath,
  casePolicy: CasePolicy,
): RelativePosixPath | undefined {
  const absRoot = normalizeOsPath(root);
  const absTarget = normalizeOsPath(osPath);
  const rel = path.relative(absRoot, absTarget);

  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return undefined;
  }

  let posix = rel.split(path.sep).join("/");
  if (posix === ".") {
    posix = "";
  }
  posix = posix.replace(/\/+$/, "");

  if (casePolicy === "insensitive") {
    // Preserve on-disk casing from absTarget relative segments when possible;
    // compare-key folding is handled separately by callers.
  }

  return asRelativePosixPath(posix);
}

export function toOsPath(
  root: AbsoluteOsPath,
  relative: RelativePosixPath,
): AbsoluteOsPath {
  if (relative === "" || relative === ".") {
    return normalizeOsPath(root);
  }
  const segments = relative.split("/").filter((s) => s.length > 0 && s !== ".");
  for (const segment of segments) {
    if (segment === "..") {
      throw new Error(`Relative path escapes root: ${relative}`);
    }
  }
  return asAbsoluteOsPath(
    normalizeOsPath(path.join(root, ...segments)),
  );
}

/** Normalize a user-supplied relative/absolute path into relative POSIX form. */
export function normalizeUserRelative(
  root: AbsoluteOsPath,
  input: string,
  casePolicy: CasePolicy,
): RelativePosixPath {
  const abs = path.isAbsolute(input)
    ? normalizeOsPath(input)
    : normalizeOsPath(path.resolve(root, input));
  const rel = toRelativePosix(root, abs, casePolicy);
  if (rel === undefined) {
    throw new Error(`Path is outside workspace root: ${input}`);
  }
  return rel;
}

export function basenamePosix(relative: RelativePosixPath | string): string {
  const parts = relative.split("/");
  return parts[parts.length - 1] ?? relative;
}

export function dirnamePosix(relative: RelativePosixPath | string): string {
  const idx = relative.lastIndexOf("/");
  if (idx <= 0) {
    return "";
  }
  return relative.slice(0, idx);
}

export function joinPosix(...parts: string[]): RelativePosixPath {
  const joined = parts
    .filter((p) => p.length > 0 && p !== ".")
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
  return asRelativePosixPath(joined);
}

export function extensionOf(relative: string): string {
  const base = basenamePosix(relative);
  const idx = base.lastIndexOf(".");
  if (idx <= 0) {
    return "";
  }
  return base.slice(idx + 1).toLowerCase();
}

export function comparePathKey(value: string, casePolicy: CasePolicy): string {
  return casePolicy === "insensitive" ? value.toLowerCase() : value;
}

export function detectDefaultCasePolicy(platform: NodeJS.Platform = process.platform): CasePolicy {
  return platform === "win32" || platform === "darwin" ? "insensitive" : "sensitive";
}

export function isWithinRoot(
  root: AbsoluteOsPath,
  candidate: AbsoluteOsPath,
  casePolicy: CasePolicy,
): boolean {
  return toRelativePosix(root, candidate, casePolicy) !== undefined;
}
