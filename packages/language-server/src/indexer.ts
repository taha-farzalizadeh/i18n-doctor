/**
 * Diagnostic index and ownership.
 *
 * Groups findings by document, then computes the exact set of publishes needed
 * to move the editor from the previously published state to the current one.
 * Files that no longer have findings are explicitly cleared, so a stale
 * underline can never survive an analysis.
 */

import type { Diagnostic } from "./protocol.js";
import type { LocatedDiagnostic } from "./diagnostics.js";
import {
  pathKey,
  pathToUri,
  type PlatformId,
} from "./workspace.js";

export interface DocumentDiagnostics {
  readonly uri: string;
  readonly absolutePath: string;
  readonly diagnostics: readonly Diagnostic[];
}

export interface DiagnosticIndex {
  /**
   * Replaces the published state with `found`.
   *
   * Returns one entry per document that must be sent to the client, including
   * empty arrays for documents this server previously owned.
   */
  publishSet(
    found: readonly LocatedDiagnostic[],
    options?: { readonly limitPerFile?: number },
  ): readonly DocumentDiagnostics[];
  /** Clears one document and returns the publish needed, if it was owned. */
  release(absolutePath: string): DocumentDiagnostics | undefined;
  /** Clears everything and returns the publishes needed. */
  releaseAll(): readonly DocumentDiagnostics[];
  /** Currently published diagnostics for a document. */
  get(absolutePath: string): readonly Diagnostic[];
  ownedPaths(): readonly string[];
}

export function createDiagnosticIndex(options?: {
  readonly platform?: PlatformId;
}): DiagnosticIndex {
  const platform = options?.platform;
  // key → { absolutePath, diagnostics } currently published.
  const owned = new Map<
    string,
    { absolutePath: string; diagnostics: readonly Diagnostic[] }
  >();

  const toPublish = (
    absolutePath: string,
    diagnostics: readonly Diagnostic[],
  ): DocumentDiagnostics => ({
    uri: pathToUri(absolutePath, platform),
    absolutePath,
    diagnostics,
  });

  return {
    publishSet(found, publishOptions) {
      const limit = publishOptions?.limitPerFile ?? Number.POSITIVE_INFINITY;
      const grouped = new Map<
        string,
        { absolutePath: string; diagnostics: Diagnostic[] }
      >();

      for (const item of found) {
        const key = pathKey(item.absolutePath, platform);
        const bucket = grouped.get(key);
        if (bucket) {
          bucket.diagnostics.push(item.diagnostic);
        } else {
          grouped.set(key, {
            absolutePath: item.absolutePath,
            diagnostics: [item.diagnostic],
          });
        }
      }

      const publishes: DocumentDiagnostics[] = [];

      for (const [key, bucket] of grouped) {
        const deduped = dedupe(bucket.diagnostics).sort(compareDiagnostics);
        const bounded =
          deduped.length > limit ? deduped.slice(0, limit) : deduped;
        const previous = owned.get(key)?.diagnostics;
        owned.set(key, {
          absolutePath: bucket.absolutePath,
          diagnostics: bounded,
        });
        // Skip no-op publishes so typing does not spam the client.
        if (previous && sameDiagnostics(previous, bounded)) continue;
        publishes.push(toPublish(bucket.absolutePath, bounded));
      }

      for (const [key, entry] of [...owned]) {
        if (grouped.has(key)) continue;
        owned.delete(key);
        if (entry.diagnostics.length === 0) continue;
        publishes.push(toPublish(entry.absolutePath, []));
      }

      return publishes;
    },

    release(absolutePath) {
      const key = pathKey(absolutePath, platform);
      const entry = owned.get(key);
      if (!entry) return undefined;
      owned.delete(key);
      if (entry.diagnostics.length === 0) return undefined;
      return toPublish(entry.absolutePath, []);
    },

    releaseAll() {
      const publishes: DocumentDiagnostics[] = [];
      for (const entry of owned.values()) {
        if (entry.diagnostics.length === 0) continue;
        publishes.push(toPublish(entry.absolutePath, []));
      }
      owned.clear();
      return publishes;
    },

    get(absolutePath) {
      return owned.get(pathKey(absolutePath, platform))?.diagnostics ?? [];
    },

    ownedPaths() {
      return [...owned.values()].map((entry) => entry.absolutePath);
    },
  };
}

function dedupe(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const id = [
      diagnostic.code,
      diagnostic.range.start.line,
      diagnostic.range.start.character,
      diagnostic.range.end.line,
      diagnostic.range.end.character,
      diagnostic.message,
    ].join("\u0000");
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(diagnostic);
  }
  return out;
}

function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  return (
    a.range.start.line - b.range.start.line ||
    a.range.start.character - b.range.start.character ||
    a.severity - b.severity ||
    a.code.localeCompare(b.code) ||
    a.message.localeCompare(b.message)
  );
}

function sameDiagnostics(
  a: readonly Diagnostic[],
  b: readonly Diagnostic[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i]!;
    const right = b[i]!;
    if (
      left.code !== right.code ||
      left.severity !== right.severity ||
      left.message !== right.message ||
      left.range.start.line !== right.range.start.line ||
      left.range.start.character !== right.range.start.character ||
      left.range.end.line !== right.range.end.line ||
      left.range.end.character !== right.range.end.character
    ) {
      return false;
    }
  }
  return true;
}
