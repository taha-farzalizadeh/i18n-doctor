/**
 * Live document tracking.
 *
 * Open documents are authoritative: analysis reads unsaved buffer text through
 * {@link createOverlayFileSystem} instead of the on-disk copy, so diagnostics
 * reflect exactly what the developer is looking at.
 */

import fsSync from "node:fs";
import path from "node:path";
import {
  createNodeFileSystem,
  type AbsoluteOsPath,
  type DirEntry,
  type FileSystemPort,
  type FsStat,
} from "@i18n-doctor/scanner";
import {
  TextDocument,
  type TextDocumentContentChangeEvent,
} from "vscode-languageserver-textdocument";
import {
  currentPlatform,
  normalizePath,
  normalizeUri,
  pathKey,
  uriToPath,
  type PlatformId,
} from "./workspace.js";

export interface TrackedDocument {
  /** Canonical `file:` URI. */
  readonly uri: string;
  /** Absolute filesystem path. */
  readonly path: string;
  readonly languageId: string;
  readonly version: number;
  readonly text: string;
}

export interface DidOpenInput {
  readonly uri: string;
  readonly languageId: string;
  readonly version: number;
  readonly text: string;
}

export interface DidChangeInput {
  readonly uri: string;
  readonly version: number;
  readonly changes: readonly TextDocumentContentChangeEvent[];
}

export interface DocumentStore {
  open(input: DidOpenInput): TrackedDocument | undefined;
  change(input: DidChangeInput): TrackedDocument | undefined;
  close(uri: string): TrackedDocument | undefined;
  get(uri: string): TrackedDocument | undefined;
  getByPath(filePath: string): TrackedDocument | undefined;
  all(): readonly TrackedDocument[];
  /** Current version of a tracked document, or undefined when not open. */
  versionOf(uri: string): number | undefined;
  /** Absolute path → text, for open documents only. */
  textOfPath(filePath: string): string | undefined;
  clear(): void;
}

interface Entry {
  readonly uri: string;
  readonly path: string;
  document: TextDocument;
}

export function createDocumentStore(options?: {
  readonly platform?: PlatformId;
}): DocumentStore {
  const platform = options?.platform ?? currentPlatform();
  const byUri = new Map<string, Entry>();
  const byPath = new Map<string, Entry>();

  const toTracked = (entry: Entry): TrackedDocument => ({
    uri: entry.uri,
    path: entry.path,
    languageId: entry.document.languageId,
    version: entry.document.version,
    text: entry.document.getText(),
  });

  const lookup = (uri: string): Entry | undefined =>
    byUri.get(normalizeUri(uri, platform));

  return {
    open(input) {
      const uri = normalizeUri(input.uri, platform);
      const filePath = uriToPath(uri, platform);
      // Non-file documents (untitled:, vscode-vfs:) have no analyzable path.
      if (filePath === undefined) return undefined;

      const normalized = normalizePath(filePath, platform);
      const entry: Entry = {
        uri,
        path: normalized,
        document: TextDocument.create(
          uri,
          input.languageId,
          input.version,
          input.text,
        ),
      };
      byUri.set(uri, entry);
      for (const key of pathAliases(normalized, platform)) {
        byPath.set(key, entry);
      }
      return toTracked(entry);
    },

    change(input) {
      const entry = lookup(input.uri);
      if (!entry) return undefined;
      // Ignore out-of-order notifications so text never moves backwards.
      if (input.version < entry.document.version) return toTracked(entry);
      entry.document = TextDocument.update(
        entry.document,
        [...input.changes],
        input.version,
      );
      return toTracked(entry);
    },

    close(uri) {
      const normalized = normalizeUri(uri, platform);
      const entry = byUri.get(normalized);
      if (!entry) return undefined;
      byUri.delete(normalized);
      for (const key of pathAliases(entry.path, platform)) {
        if (byPath.get(key) === entry) byPath.delete(key);
      }
      return toTracked(entry);
    },

    get(uri) {
      const entry = lookup(uri);
      return entry ? toTracked(entry) : undefined;
    },

    getByPath(filePath) {
      const entry = findByPath(byPath, filePath, platform);
      return entry ? toTracked(entry) : undefined;
    },

    all() {
      return [...byUri.values()].map(toTracked);
    },

    versionOf(uri) {
      return lookup(uri)?.document.version;
    },

    textOfPath(filePath) {
      return findByPath(byPath, filePath, platform)?.document.getText();
    },

    clear() {
      byUri.clear();
      byPath.clear();
    },
  };
}

function findByPath(
  byPath: Map<string, Entry>,
  filePath: string,
  platform: PlatformId,
): Entry | undefined {
  for (const key of pathAliases(filePath, platform)) {
    const entry = byPath.get(key);
    if (entry) return entry;
  }
  return undefined;
}

/**
 * Lookup keys for a path: as given, plus its symlink-resolved form.
 *
 * The scanner canonicalizes its root through `realpath`, so absolute paths in
 * analyzer output can differ from what the editor sent (notably macOS
 * `/var` → `/private/var`).
 */
function pathAliases(
  filePath: string,
  platform: PlatformId,
): readonly string[] {
  const primary = pathKey(filePath, platform);
  const real = canonicalize(filePath);
  const secondary = real === undefined ? undefined : pathKey(real, platform);
  return secondary === undefined || secondary === primary
    ? [primary]
    : [primary, secondary];
}

function canonicalize(filePath: string): string | undefined {
  try {
    return fsSync.realpathSync.native(filePath);
  } catch {
    // Unsaved file: resolve the parent directory instead.
  }
  try {
    const dir = fsSync.realpathSync.native(path.dirname(filePath));
    return path.join(dir, path.basename(filePath));
  } catch {
    return undefined;
  }
}

/**
 * Filesystem port that serves open-document text ahead of disk contents.
 *
 * Unsaved buffers are also surfaced through `stat`, `exists`, and `readDir` so
 * a never-saved file still participates in a scan.
 */
export function createOverlayFileSystem(
  documents: Pick<DocumentStore, "textOfPath" | "all">,
  options?: {
    readonly inner?: FileSystemPort;
    readonly platform?: PlatformId;
  },
): FileSystemPort {
  const inner = options?.inner ?? createNodeFileSystem();
  const platform = options?.platform ?? currentPlatform();
  const encoder = new TextEncoder();

  const overlayText = (osPath: string): string | undefined =>
    documents.textOfPath(osPath);

  return {
    resolveRoot: (rootPath) => inner.resolveRoot(rootPath),
    realpath: (osPath) => inner.realpath(osPath),

    async readDir(osPath: AbsoluteOsPath): Promise<readonly DirEntry[]> {
      let entries: readonly DirEntry[] = [];
      try {
        entries = await inner.readDir(osPath);
      } catch (error) {
        // A directory that only exists in the overlay still lists its buffers.
        if (overlayChildren(osPath).length === 0) throw error;
      }
      const known = new Set(entries.map((e) => e.name));
      const extra = overlayChildren(osPath).filter((name) => !known.has(name));
      if (extra.length === 0) return entries;
      return [
        ...entries,
        ...extra.map((name): DirEntry => ({ name, kind: "file" })),
      ];
    },

    async stat(osPath: AbsoluteOsPath): Promise<FsStat> {
      const text = overlayText(osPath);
      if (text === undefined) return inner.stat(osPath);
      const size = encoder.encode(text).byteLength;
      try {
        const disk = await inner.stat(osPath);
        return { ...disk, kind: "file", size };
      } catch {
        return { kind: "file", size, mtimeMs: Date.now() };
      }
    },

    async readFile(
      osPath: AbsoluteOsPath,
      maxBytes: number,
    ): Promise<Uint8Array> {
      const text = overlayText(osPath);
      if (text === undefined) return inner.readFile(osPath, maxBytes);
      const bytes = encoder.encode(text);
      if (bytes.byteLength > maxBytes) {
        const error = new Error(
          `File exceeds maxFileBytes (${bytes.byteLength} > ${maxBytes})`,
        );
        (error as Error & { code: string }).code = "FILE_TOO_LARGE";
        throw error;
      }
      return bytes;
    },

    async exists(osPath: AbsoluteOsPath): Promise<boolean> {
      if (overlayText(osPath) !== undefined) return true;
      return inner.exists(osPath);
    },
  };

  function overlayChildren(dir: string): readonly string[] {
    const dirKey = pathKey(dir, platform).replace(/\/+$/, "");
    const names: string[] = [];
    for (const doc of documents.all()) {
      const parent = pathKey(path.dirname(doc.path), platform).replace(
        /\/+$/,
        "",
      );
      if (parent === dirKey) names.push(path.basename(doc.path));
    }
    return names;
  }
}

/** Synchronous read hooks for config/context/suppression lookups. */
export function createOverlayReaders(
  documents: Pick<DocumentStore, "textOfPath">,
): {
  readFile: (absolutePath: string) => string | undefined;
  fileExists: (absolutePath: string) => boolean;
  readDir: (absolutePath: string) => readonly string[] | undefined;
} {
  return {
    readFile(absolutePath) {
      const overlay = documents.textOfPath(absolutePath);
      if (overlay !== undefined) return overlay;
      try {
        return fsSync.readFileSync(absolutePath, "utf8");
      } catch {
        return undefined;
      }
    },
    fileExists(absolutePath) {
      if (documents.textOfPath(absolutePath) !== undefined) return true;
      try {
        return fsSync.existsSync(absolutePath);
      } catch {
        return false;
      }
    },
    readDir(absolutePath) {
      try {
        return fsSync.readdirSync(absolutePath);
      } catch {
        return undefined;
      }
    },
  };
}
