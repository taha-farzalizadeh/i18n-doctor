import path from "node:path";
import { createAstEngine, type AstEngine } from "@i18n-unused/ast";
import type ts from "typescript";
import type { ModuleGraph, ModuleRecord } from "../api/types.js";
import type { FsAccess } from "./fs-access.js";
import {
  buildExportIndex,
  extractModuleRecord,
  type ExportIndex,
} from "./extract-module.js";
import {
  relativeToRoot,
  resolveAgainstRoot,
  toPosix,
} from "./location.js";
import type { PathResolver } from "./path-resolver.js";

export interface ModuleGraphHost {
  readonly root: string;
  readonly fsAccess: FsAccess;
  readonly pathResolver: PathResolver;
  readonly ast: AstEngine;
  readonly maxFollowDepth: number;
}

interface CachedModule {
  readonly record: ModuleRecord;
  readonly sourceText: string;
  readonly sourceFile: ts.SourceFile;
  readonly exportIndex: ExportIndex;
}

export class CachedModuleGraph implements ModuleGraph {
  private readonly cache = new Map<string, CachedModule>();
  private readonly failed = new Set<string>();

  constructor(private readonly host: ModuleGraphHost) {}

  get root(): string {
    return this.host.root;
  }

  get modulePaths(): readonly string[] {
    return [...this.cache.keys()].sort((a, b) =>
      toPosix(a).localeCompare(toPosix(b)),
    );
  }

  getModule(absolutePath: string): ModuleRecord | undefined {
    return this.cache.get(normalizeKey(absolutePath))?.record;
  }

  loadModule(absolutePath: string): ModuleRecord | undefined {
    return this.loadCached(absolutePath)?.record;
  }

  getSourceText(absolutePath: string): string | undefined {
    return this.loadCached(absolutePath)?.sourceText;
  }

  getSourceFile(absolutePath: string): ts.SourceFile | undefined {
    return this.loadCached(absolutePath)?.sourceFile;
  }

  getExportIndex(absolutePath: string): ExportIndex | undefined {
    return this.loadCached(absolutePath)?.exportIndex;
  }

  private loadCached(absolutePath: string): CachedModule | undefined {
    const key = normalizeKey(absolutePath);
    const hit = this.cache.get(key);
    if (hit) {
      return hit;
    }
    if (this.failed.has(key)) {
      return undefined;
    }

    const text = this.host.fsAccess.readFile(key);
    if (text === undefined) {
      this.failed.add(key);
      return undefined;
    }

    const parsed = this.host.ast.parse({
      fileName: key,
      sourceText: text,
    });
    const record = extractModuleRecord({
      root: this.host.root,
      absolutePath: key,
      sourceFile: parsed.sourceFile,
    });
    const entry: CachedModule = {
      record,
      sourceText: text,
      sourceFile: parsed.sourceFile,
      exportIndex: buildExportIndex(record.exports),
    };
    this.cache.set(key, entry);
    return entry;
  }

  seedEntries(entryFiles: readonly string[], followDepth: number): void {
    for (const entry of entryFiles) {
      const abs = resolveAgainstRoot(this.host.root, entry);
      this.loadModule(abs);
    }
    if (followDepth > 0) {
      this.followImports(followDepth);
    }
  }

  private followImports(maxDepth: number): void {
    let frontier = [...this.cache.keys()];
    const seen = new Set(frontier);

    for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
      const next: string[] = [];
      for (const file of frontier) {
        const mod = this.cache.get(file)?.record;
        if (!mod) continue;
        const specifiers = new Set<string>([
          ...mod.imports.map((i) => i.specifier),
          ...mod.starExports.map((s) => s.specifier),
          ...mod.sideEffectImports.map((s) => s.specifier),
          ...mod.exports
            .filter((e) => e.fromSpecifier)
            .map((e) => e.fromSpecifier!),
        ]);
        for (const spec of specifiers) {
          const resolved = this.host.pathResolver.resolve(file, spec);
          if (!resolved) continue;
          const abs = normalizeKey(resolved.absolutePath);
          if (seen.has(abs)) continue;
          if (this.loadModule(abs)) {
            seen.add(abs);
            next.push(abs);
          }
        }
      }
      frontier = next;
    }
  }

  clear(): void {
    this.cache.clear();
    this.failed.clear();
  }
}

export function createModuleGraph(host: ModuleGraphHost): CachedModuleGraph {
  return new CachedModuleGraph(host);
}

export function toAbsoluteModulePath(root: string, filePath: string): string {
  return resolveAgainstRoot(root, filePath);
}

export function moduleRelative(root: string, absolutePath: string): string {
  return relativeToRoot(root, absolutePath);
}

function normalizeKey(absolutePath: string): string {
  return path.normalize(absolutePath);
}

export function createAst(): AstEngine {
  return createAstEngine({ cache: true, cacheSize: 4000 });
}
