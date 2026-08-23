/**
 * Workspace discovery and `file:` URI ↔ filesystem path conversion.
 *
 * Project root, config, and scope selection all delegate to the existing
 * discovery in @i18n-doctor/cli and @i18n-doctor/config.
 */

import fsSync from "node:fs";
import path from "node:path";
import {
  discoverProject,
  hasWorkspaceField,
  resolveAnalysisScopes,
} from "@i18n-doctor/cli";
import {
  CONFIG_FILENAMES,
  createEffectiveConfigResolver,
  type EffectiveConfig,
} from "@i18n-doctor/config";
import type { Logger } from "./logger.js";

export type PlatformId = "win32" | "posix";

export function currentPlatform(): PlatformId {
  return process.platform === "win32" ? "win32" : "posix";
}

const WINDOWS_DRIVE = /^[a-zA-Z]:$/;

/**
 * Converts a filesystem path to a `file:` URI.
 *
 * Windows drive paths and UNC shares are handled explicitly so the result is
 * stable regardless of which IDE produced the original path.
 */
export function pathToUri(
  filePath: string,
  platform: PlatformId = currentPlatform(),
): string {
  if (filePath.startsWith("file://")) {
    return normalizeUri(filePath, platform);
  }

  const slashed = filePath.replace(/\\/g, "/");

  // UNC share: //server/share/dir → file://server/share/dir
  if (platform === "win32" && slashed.startsWith("//")) {
    const withoutPrefix = slashed.slice(2);
    const slash = withoutPrefix.indexOf("/");
    const authority = slash === -1 ? withoutPrefix : withoutPrefix.slice(0, slash);
    const rest = slash === -1 ? "" : withoutPrefix.slice(slash);
    return `file://${encodeSegments(authority)}${encodeSegments(rest)}`;
  }

  const withLeadingSlash = slashed.startsWith("/") ? slashed : `/${slashed}`;
  return `file://${encodeSegments(withLeadingSlash)}`;
}

/**
 * Converts a `file:` URI to a filesystem path.
 *
 * Returns undefined for non-file schemes (untitled buffers, virtual documents),
 * which the server skips rather than guessing a path for.
 */
export function uriToPath(
  uri: string,
  platform: PlatformId = currentPlatform(),
): string | undefined {
  if (!uri.startsWith("file:")) return undefined;

  let rest = uri.slice("file:".length);
  let authority = "";
  if (rest.startsWith("//")) {
    rest = rest.slice(2);
    const slash = rest.indexOf("/");
    if (slash === -1) {
      authority = rest;
      rest = "";
    } else {
      authority = rest.slice(0, slash);
      rest = rest.slice(slash);
    }
  }

  // Drop query/fragment before decoding — they are not part of the path.
  const queryIndex = rest.search(/[?#]/);
  if (queryIndex !== -1) rest = rest.slice(0, queryIndex);

  let decoded = safeDecode(rest);
  const decodedAuthority = safeDecode(authority);

  if (platform === "win32") {
    if (decodedAuthority && decodedAuthority.toLowerCase() !== "localhost") {
      return `\\\\${decodedAuthority}${decoded.replace(/\//g, "\\")}`;
    }
    // "/C:/dir" → "C:/dir"
    if (/^\/[a-zA-Z]:/.test(decoded)) {
      decoded = decoded.slice(1);
    }
    const normalized = decoded.replace(/\//g, "\\");
    return normalized.length > 0 ? normalized : "\\";
  }

  return decoded.length > 0 ? decoded : "/";
}

/**
 * Canonical URI form used as a map key.
 *
 * IDEs disagree about percent-encoding (`c%3A` vs `c:`) and drive-letter case,
 * so every incoming URI is round-tripped through the path form.
 */
export function normalizeUri(
  uri: string,
  platform: PlatformId = currentPlatform(),
): string {
  const filePath = uriToPath(uri, platform);
  if (filePath === undefined) return uri;
  return pathToUri(normalizePath(filePath, platform), platform);
}

/** Normalizes separators, `.`/`..` segments, and Windows drive-letter case. */
export function normalizePath(
  filePath: string,
  platform: PlatformId = currentPlatform(),
): string {
  const impl = platform === "win32" ? path.win32 : path.posix;
  const normalized = impl.normalize(filePath);
  if (platform !== "win32") return normalized;
  const [drive, ...tail] = normalized.split(":");
  if (drive !== undefined && WINDOWS_DRIVE.test(`${drive}:`)) {
    return [drive.toUpperCase(), ...tail].join(":");
  }
  return normalized;
}

/**
 * Comparison key for path/URI maps.
 *
 * Windows and (by default) macOS filesystems are case-insensitive, so keys are
 * lowercased there to keep editor-supplied casing from missing a lookup.
 */
export function pathKey(
  filePath: string,
  platform: PlatformId = currentPlatform(),
): string {
  const normalized = stripTrailingSlash(
    normalizePath(filePath, platform).replace(/\\/g, "/"),
  );
  return isCaseInsensitive(platform) ? normalized.toLowerCase() : normalized;
}

/** Drops a trailing separator so `/work/a/` and `/work/a` share one key. */
function stripTrailingSlash(value: string): string {
  if (value.length <= 1 || !value.endsWith("/")) return value;
  // Keep `/` and `C:/` intact.
  const stripped = value.slice(0, -1);
  return WINDOWS_DRIVE.test(stripped) ? value : stripped;
}

function isCaseInsensitive(platform: PlatformId): boolean {
  return platform === "win32" || process.platform === "darwin";
}

/** True when `child` is inside `parent` (or equal to it). */
export function isWithin(
  parent: string,
  child: string,
  platform: PlatformId = currentPlatform(),
): boolean {
  const p = pathKey(parent, platform).replace(/\/+$/, "");
  const c = pathKey(child, platform);
  return c === p || c.startsWith(`${p}/`);
}

function encodeSegments(value: string): string {
  return value
    .split("/")
    .map((segment) =>
      // A drive letter keeps its colon, matching Node's `pathToFileURL` and
      // the `file:///c:/…` form both VS Code and JetBrains accept.
      WINDOWS_DRIVE.test(segment) ? segment : encodeURIComponent(segment),
    )
    .join("/");
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Subset of LSP `InitializeParams` needed to locate the workspace. */
export interface WorkspaceInitParams {
  readonly rootUri?: string | null;
  readonly rootPath?: string | null;
  readonly workspaceFolders?: readonly { readonly uri: string }[] | null;
}

/**
 * Resolves candidate workspace roots, preferring `workspaceFolders` and
 * falling back through the deprecated `rootUri`/`rootPath` fields to cwd.
 */
export function resolveWorkspaceRoots(
  params: WorkspaceInitParams,
  options: { readonly cwd?: string; readonly platform?: PlatformId } = {},
): readonly string[] {
  const platform = options.platform ?? currentPlatform();
  const roots: string[] = [];
  const seen = new Set<string>();

  const add = (candidate: string | undefined | null): void => {
    if (!candidate) return;
    const normalized = normalizePath(candidate, platform);
    const key = pathKey(normalized, platform);
    if (seen.has(key)) return;
    seen.add(key);
    roots.push(normalized);
  };

  for (const folder of params.workspaceFolders ?? []) {
    add(uriToPath(folder.uri, platform));
  }
  // `workspaceFolders` supersedes the deprecated single-root fields; adding
  // them anyway would analyze a directory the client never opened.
  if (roots.length === 0) {
    if (params.rootUri) add(uriToPath(params.rootUri, platform));
    if (params.rootPath) add(params.rootPath);
  }

  if (roots.length === 0) add(options.cwd ?? process.cwd());
  return roots;
}

export interface DiscoveredWorkspace {
  /** Package root discovered by walking up from the folder. */
  readonly root: string;
  /** Absolute path of the i18n-doctor config file, when one exists. */
  readonly configPath?: string;
  /** Absolute path of the owning package.json, when one exists. */
  readonly packageJsonPath?: string;
  readonly isMonorepo: boolean;
  /** Effective config per analysis scope (root, or one per package). */
  readonly scopes: readonly EffectiveConfig[];
}

/**
 * Locates the project root, its config, and its analysis scopes.
 *
 * Delegates to `discoverProject` (package.json walk-up), the effective config
 * resolver, and the CLI's scope-selection policy — the language server adds no
 * discovery rules of its own.
 */
export function discoverWorkspace(
  folder: string,
  logger?: Logger,
): DiscoveredWorkspace {
  const project = discoverProject({ pathArg: folder, cwd: folder });
  const root = project.root;

  const resolver = createEffectiveConfigResolver();
  const rootConfig = resolver.resolve({ root });
  const scopes = resolveAnalysisScopes(resolver, rootConfig, { root });

  const configPath = findConfigFile(root);
  const packageJsonPath = path.join(root, "package.json");
  const hasPackageJson = fileExists(packageJsonPath);

  logger?.debug(
    `workspace resolved: root=${root} scopes=${scopes.length} config=${configPath ?? "<none>"}`,
  );

  return {
    root,
    ...(configPath !== undefined ? { configPath } : {}),
    ...(hasPackageJson ? { packageJsonPath } : {}),
    isMonorepo: hasWorkspaceField(root) || (rootConfig.packages?.length ?? 0) > 0,
    scopes,
  };
}

/** First config filename that exists at `root`, in discovery precedence order. */
export function findConfigFile(root: string): string | undefined {
  for (const name of CONFIG_FILENAMES) {
    const candidate = path.join(root, name);
    if (fileExists(candidate)) return candidate;
  }
  return undefined;
}

/** True when the path is an i18n-doctor config file or a package.json. */
export function isConfigPath(filePath: string): boolean {
  const base = path.basename(filePath);
  return (
    base === "package.json" ||
    (CONFIG_FILENAMES as readonly string[]).includes(base)
  );
}

function fileExists(absolutePath: string): boolean {
  try {
    return fsSync.statSync(absolutePath).isFile();
  } catch {
    return false;
  }
}
