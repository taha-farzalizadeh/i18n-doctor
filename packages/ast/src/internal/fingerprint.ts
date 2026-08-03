/**
 * Cheap non-cryptographic content identity for cache keys when contentHash is absent.
 * Not for security — only collision resistance for parse-cache invalidation.
 */
export function contentFingerprint(text: string): string {
  // FNV-1a 32-bit over UTF-16 code units + length
  let hash = 0x811c9dc5;
  const len = text.length;
  for (let i = 0; i < len; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${len.toString(36)}:${(hash >>> 0).toString(36)}`;
}

export function utf8ByteLength(text: string): number {
  // Fast path for ASCII-heavy source
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x80) {
      bytes += 1;
    } else if (c < 0x800) {
      bytes += 2;
    } else if (c >= 0xd800 && c <= 0xdbff) {
      // surrogate pair
      bytes += 4;
      i += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}
