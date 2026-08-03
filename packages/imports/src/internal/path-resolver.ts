import path from "node:path";
import type { ModuleResolveResult } from "../api/types.js";
import type { FsAccess } from "./fs-access.js";
import { relativeToRoot, toPosix } from "./location.js";
import {
  loadTsconfigPaths,
  matchTsconfigPaths,
  type TsconfigPathMap,
} from "./tsconfig-paths.js";

const DEFAULT_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
] as const;

export interface PathResolver {
  resolve(
    fromFile: string,
    specifier: string,
  ): ModuleResolveResult | undefined;
  clearCache(): void;
}

export function createPathResolver(input: {
  root: string;
  aliases: Readonly<Record<string, string>>;
  extensions: readonly string[];
  indexNames: readonly string[];
  tsconfigPath?: string;
  fsAccess: FsAccess;
}): PathResolver {
  const cache = new Map<string, ModuleResolveResult | null>();
  let pathMap: TsconfigPathMap | undefined | null = null;

  const getPathMap = (): TsconfigPathMap | undefined => {
    if (pathMap === null) {
      pathMap = input.tsconfigPath
        ? loadTsconfigPaths(input.tsconfigPath, input.fsAccess)
        : undefined;
    }
    return pathMap ?? undefined;
  };

  const tryFile = (
    absoluteBase: string,
    strategy: ModuleResolveResult["strategy"],
    confidence: number,
  ): ModuleResolveResult | undefined => {
    const hit = resolveWithExtensions(
      path.normalize(absoluteBase),
      input.extensions,
      input.indexNames,
      input.fsAccess,
    );
    if (!hit) {
      return undefined;
    }
    return {
      absolutePath: hit.path,
      relativePath: relativeToRoot(input.root, hit.path),
      confidence,
      strategy: hit.viaIndex ? "index" : hit.viaExt ? "extension" : strategy,
    };
  };

  return {
    clearCache() {
      cache.clear();
      pathMap = null;
    },
    resolve(fromFile, specifier) {
      const from = path.normalize(fromFile);
      const key = `${toPosix(from)}::${specifier}`;
      if (cache.has(key)) {
        return cache.get(key) ?? undefined;
      }

      const result = resolveSpecifier(from, specifier, {
        root: input.root,
        aliases: input.aliases,
        tryFile,
        getPathMap,
      });
      cache.set(key, result ?? null);
      return result;
    },
  };
}

function resolveSpecifier(
  fromFile: string,
  specifier: string,
  ctx: {
    root: string;
    aliases: Readonly<Record<string, string>>;
    tryFile: (
      absoluteBase: string,
      strategy: ModuleResolveResult["strategy"],
      confidence: number,
    ) => ModuleResolveResult | undefined;
    getPathMap: () => TsconfigPathMap | undefined;
  },
): ModuleResolveResult | undefined {
  if (!specifier || specifier.startsWith("\0") || specifier.includes("!")) {
    return undefined;
  }

  // Relative
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const base = path.resolve(path.dirname(fromFile), specifier);
    return ctx.tryFile(base, "relative", 0.95);
  }

  // Configured aliases (longest prefix wins)
  const aliasHit = matchAlias(specifier, ctx.aliases, ctx.root);
  if (aliasHit) {
    const hit = ctx.tryFile(aliasHit, "alias", 0.9);
    if (hit) return hit;
  }

  // tsconfig paths (no bare node_modules fallback)
  const pathMap = ctx.getPathMap();
  if (pathMap) {
    for (const candidate of matchTsconfigPaths(specifier, pathMap)) {
      const hit = ctx.tryFile(candidate, "tsconfig-paths", 0.88);
      if (hit) return hit;
    }
  }

  // Absolute filesystem path
  if (path.isAbsolute(specifier)) {
    return ctx.tryFile(specifier, "relative", 0.85);
  }

  return undefined;
}

function matchAlias(
  specifier: string,
  aliases: Readonly<Record<string, string>>,
  root: string,
): string | undefined {
  const entries = Object.entries(aliases).sort(
    (a, b) => b[0].length - a[0].length,
  );
  for (const [prefix, target] of entries) {
    if (!specifier.startsWith(prefix)) {
      continue;
    }
    // Keep remainder relative — path.join('/src', '/keys') => '/keys' (bug).
    const rest = specifier.slice(prefix.length).replace(/^[/\\]+/, "");
    const targetPath = path.isAbsolute(target)
      ? target
      : path.resolve(root, target);
    return rest.length === 0 ? targetPath : path.resolve(targetPath, rest);
  }
  return undefined;
}

function resolveWithExtensions(
  absoluteBase: string,
  extensions: readonly string[],
  indexNames: readonly string[],
  fsAccess: FsAccess,
): { path: string; viaExt: boolean; viaIndex: boolean } | undefined {
  if (fsAccess.fileExists(absoluteBase)) {
    return { path: absoluteBase, viaExt: false, viaIndex: false };
  }

  // Avoid foo.ts.ts when the base already has a known extension.
  const hasKnownExt = extensions.some(
    (ext) => absoluteBase.endsWith(ext) || absoluteBase.endsWith(".d.ts"),
  );

  if (!hasKnownExt) {
    for (const ext of extensions) {
      const candidate = absoluteBase + ext;
      if (fsAccess.fileExists(candidate)) {
        return { path: candidate, viaExt: true, viaIndex: false };
      }
    }
  }

  for (const indexName of indexNames) {
    for (const ext of extensions) {
      const candidate = path.join(absoluteBase, `${indexName}${ext}`);
      if (fsAccess.fileExists(candidate)) {
        return { path: candidate, viaExt: true, viaIndex: true };
      }
    }
  }

  return undefined;
}

export function defaultExtensions(): readonly string[] {
  return DEFAULT_EXTENSIONS;
}
