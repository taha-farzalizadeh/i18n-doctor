import type { AstContentKey, ParsedFile } from "../api/types.js";
import { contentFingerprint, utf8ByteLength } from "./fingerprint.js";

/**
 * LRU parse cache keyed by fileId + content identity.
 * Designed so future incremental parsing can reuse unchanged ASTs.
 */
export class ParseCache {
  private readonly map = new Map<string, ParsedFile>();

  constructor(private readonly maxSize: number) {}

  get(key: AstContentKey): ParsedFile | undefined {
    const cacheKey = toCacheKey(key);
    const hit = this.map.get(cacheKey);
    if (!hit) {
      return undefined;
    }
    // Refresh LRU order
    this.map.delete(cacheKey);
    this.map.set(cacheKey, hit);
    return hit;
  }

  set(key: AstContentKey, value: ParsedFile): void {
    if (this.maxSize <= 0) {
      return;
    }
    const cacheKey = toCacheKey(key);
    if (this.map.has(cacheKey)) {
      this.map.delete(cacheKey);
    }
    this.map.set(cacheKey, value);
    while (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.map.delete(oldest);
    }
  }

  invalidateFile(fileId: string): void {
    const prefix = `${fileId}\0`;
    for (const key of this.map.keys()) {
      if (key.startsWith(prefix)) {
        this.map.delete(key);
      }
    }
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

type ContentKeyInternal = AstContentKey & { readonly fingerprint?: string };

function toCacheKey(key: ContentKeyInternal): string {
  // Prefer explicit contentHash; otherwise fingerprint avoids size/mtime collisions.
  const identity = key.contentHash ?? `fp:${key.fingerprint ?? String(key.size)}`;
  return `${key.fileId}\0${identity}`;
}

export function buildContentKey(
  fileId: string,
  fileName: string,
  sourceText: string,
  contentHash?: string,
  mtimeMs?: number,
): AstContentKey & { fingerprint?: string } {
  const size = utf8ByteLength(sourceText);
  const fingerprint =
    contentHash === undefined ? contentFingerprint(sourceText) : undefined;

  return {
    fileId,
    fileName,
    size,
    ...(contentHash !== undefined ? { contentHash } : {}),
    ...(mtimeMs !== undefined ? { mtimeMs } : {}),
    ...(fingerprint !== undefined ? { fingerprint } : {}),
  };
}
