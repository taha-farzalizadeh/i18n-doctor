import path from "node:path";
import type { ImportResolverFactory } from "../api/resolver.js";
import type {
  BuildGraphInput,
  ImportResolver,
  ImportResolverOptions,
  ModuleGraph,
  ModuleResolveResult,
  ResolveSpecifierInput,
  ResolveSymbolInput,
  SymbolResolution,
} from "../api/types.js";
import { createFsAccess } from "./fs-access.js";
import { resolveAgainstRoot } from "./location.js";
import {
  createAst,
  createModuleGraph,
  type CachedModuleGraph,
} from "./module-graph.js";
import {
  createPathResolver,
  defaultExtensions,
  type PathResolver,
} from "./path-resolver.js";
import { resolveSymbolReference } from "./symbol-resolver.js";
import { defaultTsconfigPath } from "./tsconfig-paths.js";

class DefaultImportResolver implements ImportResolver {
  private readonly root: string;
  private readonly maxDepth: number;
  private readonly pathResolver: PathResolver;
  private graph: CachedModuleGraph | undefined;
  private readonly options: ImportResolverOptions;
  private readonly fsAccess;

  constructor(options: ImportResolverOptions) {
    this.options = options;
    this.root = path.resolve(options.root);
    this.maxDepth = options.maxDepth ?? 32;
    this.fsAccess = createFsAccess({ ...options, root: this.root });

    const tsconfigPath =
      options.tsconfigPath ??
      defaultTsconfigPath(this.root, this.fsAccess);

    this.pathResolver = createPathResolver({
      root: this.root,
      aliases: options.aliases ?? {},
      extensions: options.extensions ?? defaultExtensions(),
      indexNames: options.indexNames ?? ["index"],
      ...(tsconfigPath !== undefined ? { tsconfigPath } : {}),
      fsAccess: this.fsAccess,
    });
  }

  buildGraph(input: BuildGraphInput = {}): ModuleGraph {
    if (!this.graph) {
      this.graph = createModuleGraph({
        root: this.root,
        fsAccess: this.fsAccess,
        pathResolver: this.pathResolver,
        ast: createAst(),
        maxFollowDepth: input.followDepth ?? 0,
      });
    }
    if (input.entryFiles && input.entryFiles.length > 0) {
      this.graph.seedEntries(input.entryFiles, input.followDepth ?? 0);
    }
    return this.graph;
  }

  resolveSpecifier(input: ResolveSpecifierInput): ModuleResolveResult | undefined {
    const fromFile = resolveAgainstRoot(this.root, input.fromFile);
    return this.pathResolver.resolve(fromFile, input.specifier);
  }

  resolveSymbol(input: ResolveSymbolInput): SymbolResolution {
    // Graphs from buildGraph() are CachedModuleGraph instances.
    const graph = input.graph as CachedModuleGraph;

    return resolveSymbolReference({
      graph,
      pathResolver: this.pathResolver,
      filePath: input.filePath,
      identifier: input.identifier,
      ...(input.position !== undefined ? { position: input.position } : {}),
      ...(input.location !== undefined ? { location: input.location } : {}),
      maxDepth: this.maxDepth,
    });
  }

  clearCache(): void {
    this.pathResolver.clearCache();
    this.graph?.clear();
    this.graph = undefined;
  }
}

export function createImportResolver(
  options: ImportResolverOptions,
): ImportResolver {
  return new DefaultImportResolver(options);
}

export const importResolverFactory: ImportResolverFactory = {
  createImportResolver,
};
