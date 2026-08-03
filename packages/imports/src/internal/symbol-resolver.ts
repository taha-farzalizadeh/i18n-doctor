import path from "node:path";
import type {
  ExportBinding,
  ImportBinding,
  ModuleRecord,
  ResolutionStep,
  SourceLocation,
  SymbolResolution,
} from "../api/types.js";
import { findLocalDeclaration } from "./extract-module.js";
import { locationAt } from "./location.js";
import type { CachedModuleGraph } from "./module-graph.js";
import type { PathResolver } from "./path-resolver.js";

export function resolveSymbolReference(input: {
  graph: CachedModuleGraph;
  pathResolver: PathResolver;
  filePath: string;
  identifier: string;
  position?: number;
  location?: SourceLocation;
  maxDepth: number;
}): SymbolResolution {
  const usageFile = toAbsolute(input.graph.root, input.filePath);
  const module = input.graph.loadModule(usageFile);
  const usageLocation =
    input.location ??
    syntheticLocation(input.graph, usageFile, input.position ?? 0);

  const usageStep: ResolutionStep = module
    ? {
        kind: "usage",
        absolutePath: usageFile,
        relativePath: module.relativePath,
        symbol: input.identifier,
        location: usageLocation,
      }
    : {
        kind: "usage",
        absolutePath: usageFile,
        symbol: input.identifier,
        location: usageLocation,
      };
  const chain: ResolutionStep[] = [usageStep];

  if (!module) {
    return unresolved(input.identifier, usageFile, usageLocation, chain);
  }

  const importBinding = selectImport(
    module.imports,
    input.identifier,
    input.position,
  );

  if (importBinding) {
    chain.push({
      kind: "import",
      absolutePath: usageFile,
      relativePath: module.relativePath,
      symbol: importBinding.localName,
      specifier: importBinding.specifier,
      location: importBinding.location,
    });

    if (importBinding.kind === "namespace") {
      return {
        originalUsage: usageMeta(
          usageFile,
          module.relativePath,
          input.identifier,
          usageLocation,
        ),
        resolvedSourceFile: usageFile,
        resolvedRelativePath: module.relativePath,
        exportedSymbol: "*",
        localName: importBinding.localName,
        declarationLocation: importBinding.location,
        resolutionChain: freeze(chain),
        confidence: 0.55,
        circular: false,
        unresolved: true,
      };
    }

    return followExport({
      graph: input.graph,
      pathResolver: input.pathResolver,
      fromFile: usageFile,
      specifier: importBinding.specifier,
      exportName: importBinding.importedName,
      chain,
      maxDepth: input.maxDepth,
      usage: usageMeta(
        usageFile,
        module.relativePath,
        input.identifier,
        usageLocation,
      ),
      confidence: 0.95,
      visited: new Set<string>(),
    });
  }

  // Local declaration in the same file (not imported).
  const sf = input.graph.getSourceFile(usageFile);
  if (sf) {
    const decl = findLocalDeclaration(sf, input.identifier);
    if (decl) {
      chain.push({
        kind: "declaration",
        absolutePath: usageFile,
        relativePath: module.relativePath,
        symbol: input.identifier,
        location: decl,
      });
      return {
        originalUsage: usageMeta(
          usageFile,
          module.relativePath,
          input.identifier,
          usageLocation,
        ),
        resolvedSourceFile: usageFile,
        resolvedRelativePath: module.relativePath,
        exportedSymbol: input.identifier,
        localName: input.identifier,
        declarationLocation: decl,
        resolutionChain: freeze(chain),
        confidence: 0.9,
        circular: false,
        unresolved: false,
      };
    }
  }

  return unresolved(
    input.identifier,
    usageFile,
    usageLocation,
    chain,
    module.relativePath,
  );
}

function followExport(input: {
  graph: CachedModuleGraph;
  pathResolver: PathResolver;
  fromFile: string;
  specifier: string;
  exportName: string;
  chain: ResolutionStep[];
  maxDepth: number;
  usage: SymbolResolution["originalUsage"];
  confidence: number;
  visited: Set<string>;
  depth?: number;
}): SymbolResolution {
  const depth = input.depth ?? 0;
  if (depth >= input.maxDepth) {
    return {
      ...unresolved(
        input.usage.identifier,
        input.usage.absolutePath,
        input.usage.location,
        input.chain,
        input.usage.relativePath,
      ),
      circular: true,
      confidence: 0,
    };
  }

  const resolved = input.pathResolver.resolve(input.fromFile, input.specifier);
  if (!resolved) {
    return unresolved(
      input.usage.identifier,
      input.usage.absolutePath,
      input.usage.location,
      [
        ...input.chain,
        {
          kind: "module",
          specifier: input.specifier,
          symbol: input.exportName,
        },
      ],
      input.usage.relativePath,
    );
  }

  const visitKey = `${resolved.absolutePath}::${input.exportName}`;
  if (input.visited.has(visitKey)) {
    return {
      ...unresolved(
        input.usage.identifier,
        input.usage.absolutePath,
        input.usage.location,
        [
          ...input.chain,
          {
            kind: "module",
            absolutePath: resolved.absolutePath,
            relativePath: resolved.relativePath,
            specifier: input.specifier,
            symbol: input.exportName,
          },
        ],
        input.usage.relativePath,
      ),
      circular: true,
      confidence: 0,
    };
  }

  const visited = new Set(input.visited);
  visited.add(visitKey);

  const chain: ResolutionStep[] = [
    ...input.chain,
    {
      kind: "module",
      absolutePath: resolved.absolutePath,
      relativePath: resolved.relativePath,
      specifier: input.specifier,
      symbol: input.exportName,
    },
  ];

  const mod = input.graph.loadModule(resolved.absolutePath);
  if (!mod) {
    return unresolved(
      input.usage.identifier,
      input.usage.absolutePath,
      input.usage.location,
      chain,
      input.usage.relativePath,
    );
  }

  // Namespace re-export: export * as ns from "./x"
  if (input.exportName !== "*") {
    const index = input.graph.getExportIndex(mod.absolutePath);
    const direct = index?.byName.get(input.exportName);
    if (direct) {
      // Ambiguous local duplicates → unresolved
      const all = index?.allByName.get(input.exportName) ?? [];
      const sameKindLocals = all.filter(
        (b) => b.kind === "local" || b.kind === "default",
      );
      if (sameKindLocals.length > 1) {
        return {
          ...unresolved(
            input.usage.identifier,
            input.usage.absolutePath,
            input.usage.location,
            chain,
            input.usage.relativePath,
          ),
          confidence: 0,
        };
      }

      return resolveExportBinding({
        binding: direct,
        module: mod,
        graph: input.graph,
        pathResolver: input.pathResolver,
        chain,
        maxDepth: input.maxDepth,
        usage: input.usage,
        confidence: Math.min(input.confidence, resolved.confidence),
        visited,
        depth: depth + 1,
      });
    }
  }

  // export * from — search without mutating sibling attempts
  if (input.exportName !== "default" && input.exportName !== "*") {
    const hits: SymbolResolution[] = [];
    for (const star of mod.starExports) {
      const starChain: ResolutionStep[] = [
        ...chain,
        {
          kind: "star-export",
          absolutePath: mod.absolutePath,
          relativePath: mod.relativePath,
          specifier: star.specifier,
          symbol: input.exportName,
          location: star.location,
        },
      ];
      const viaStar = followExport({
        graph: input.graph,
        pathResolver: input.pathResolver,
        fromFile: mod.absolutePath,
        specifier: star.specifier,
        exportName: input.exportName,
        chain: starChain,
        maxDepth: input.maxDepth,
        usage: input.usage,
        confidence: Math.min(input.confidence, 0.85),
        visited,
        depth: depth + 1,
      });
      if (viaStar.circular) {
        return viaStar;
      }
      if (!viaStar.unresolved) {
        hits.push(viaStar);
      }
    }

    if (hits.length === 1) {
      return hits[0]!;
    }
    if (hits.length > 1) {
      const sources = new Set(hits.map((h) => h.resolvedSourceFile));
      if (sources.size === 1) {
        return hits[0]!;
      }
      // Ambiguous export * collision
      return {
        ...unresolved(
          input.usage.identifier,
          input.usage.absolutePath,
          input.usage.location,
          chain,
          input.usage.relativePath,
        ),
        confidence: 0,
      };
    }
  }

  return unresolved(
    input.usage.identifier,
    input.usage.absolutePath,
    input.usage.location,
    chain,
    input.usage.relativePath,
  );
}

function resolveExportBinding(input: {
  binding: ExportBinding;
  module: ModuleRecord;
  graph: CachedModuleGraph;
  pathResolver: PathResolver;
  chain: ResolutionStep[];
  maxDepth: number;
  usage: SymbolResolution["originalUsage"];
  confidence: number;
  visited: Set<string>;
  depth: number;
}): SymbolResolution {
  const { binding, module } = input;

  // export * as ns from "./mod" — terminal namespace binding
  if (
    binding.kind === "re-export" &&
    binding.fromSpecifier &&
    binding.fromExportName === "*"
  ) {
    return {
      originalUsage: input.usage,
      resolvedSourceFile: module.absolutePath,
      resolvedRelativePath: module.relativePath,
      exportedSymbol: binding.exportName,
      declarationLocation: binding.location,
      resolutionChain: freeze([
        ...input.chain,
        {
          kind: "re-export",
          absolutePath: module.absolutePath,
          relativePath: module.relativePath,
          symbol: binding.exportName,
          specifier: binding.fromSpecifier,
          location: binding.location,
        },
      ]),
      confidence: roundConfidence(Math.min(input.confidence, 0.7)),
      circular: false,
      unresolved: true,
    };
  }

  if (binding.kind === "re-export" && binding.fromSpecifier) {
    return followExport({
      graph: input.graph,
      pathResolver: input.pathResolver,
      fromFile: module.absolutePath,
      specifier: binding.fromSpecifier,
      exportName: binding.fromExportName ?? binding.exportName,
      chain: [
        ...input.chain,
        {
          kind: "re-export",
          absolutePath: module.absolutePath,
          relativePath: module.relativePath,
          symbol: binding.exportName,
          specifier: binding.fromSpecifier,
          location: binding.location,
        },
      ],
      maxDepth: input.maxDepth,
      usage: input.usage,
      confidence: Math.min(input.confidence, 0.9),
      visited: input.visited,
      depth: input.depth,
    });
  }

  const chain: ResolutionStep[] = [
    ...input.chain,
    {
      kind: "export",
      absolutePath: module.absolutePath,
      relativePath: module.relativePath,
      symbol: binding.exportName,
      location: binding.location,
    },
  ];

  const localName = binding.localName ?? binding.exportName;
  let declarationLocation = binding.location;
  if (binding.localName) {
    const sf = input.graph.getSourceFile(module.absolutePath);
    if (sf) {
      declarationLocation =
        findLocalDeclaration(sf, binding.localName) ?? binding.location;
    }
  }

  chain.push({
    kind: "declaration",
    absolutePath: module.absolutePath,
    relativePath: module.relativePath,
    symbol: localName,
    location: declarationLocation,
  });

  return {
    originalUsage: input.usage,
    resolvedSourceFile: module.absolutePath,
    resolvedRelativePath: module.relativePath,
    exportedSymbol: binding.exportName,
    ...(binding.localName !== undefined
      ? { localName: binding.localName }
      : {}),
    declarationLocation,
    resolutionChain: freeze(chain),
    confidence: roundConfidence(input.confidence),
    circular: false,
    unresolved: false,
  };
}

function selectImport(
  imports: readonly ImportBinding[],
  localName: string,
  position: number | undefined,
): ImportBinding | undefined {
  const matches = imports.filter((i) => i.localName === localName);
  if (matches.length === 0) {
    return undefined;
  }
  if (position === undefined) {
    return matches[matches.length - 1];
  }
  let best: ImportBinding | undefined;
  for (const imp of matches) {
    if (imp.location.start <= position) {
      if (!best || imp.location.start >= best.location.start) {
        best = imp;
      }
    }
  }
  return best ?? matches[0];
}

function toAbsolute(root: string, filePath: string): string {
  return path.normalize(
    path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath),
  );
}

function syntheticLocation(
  graph: CachedModuleGraph,
  absolutePath: string,
  position: number,
): SourceLocation {
  const sf = graph.getSourceFile(absolutePath);
  const text = graph.getSourceText(absolutePath);
  if (!sf || !text) {
    return {
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: 1,
      start: position,
      end: position,
    };
  }
  return locationAt(sf, Math.min(Math.max(0, position), text.length));
}

function usageMeta(
  absolutePath: string,
  relativePath: string,
  identifier: string,
  location: SourceLocation,
): SymbolResolution["originalUsage"] {
  return { absolutePath, relativePath, identifier, location };
}

function unresolved(
  identifier: string,
  absolutePath: string,
  location: SourceLocation,
  chain: readonly ResolutionStep[],
  relativePath = "",
): SymbolResolution {
  return {
    originalUsage: {
      absolutePath,
      relativePath,
      identifier,
      location,
    },
    resolvedSourceFile: absolutePath,
    resolvedRelativePath: relativePath,
    exportedSymbol: identifier,
    declarationLocation: location,
    resolutionChain: freeze(chain),
    confidence: 0,
    circular: false,
    unresolved: true,
  };
}

function freeze(chain: readonly ResolutionStep[]): readonly ResolutionStep[] {
  return Object.freeze([...chain]);
}

function roundConfidence(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}
