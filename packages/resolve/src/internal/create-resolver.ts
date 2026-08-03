import type { LocalResolverFactory } from "../api/resolver.js";
import type {
  AnalyzeInput,
  FileAliasAnalysis,
  LocalResolver,
  LocalResolverOptions,
  ResolveIdentifierInput,
  ResolutionResult,
} from "../api/types.js";
import { collectAliasBindings } from "./alias-graph.js";
import { detectFunctionAliases } from "./function-alias.js";
import { locationAt } from "./location.js";
import { normalizeOptions, resolveIdentifier } from "./resolve-walk.js";
import { buildScopeTable } from "./scopes.js";

function mergeOptions(
  defaults: LocalResolverOptions,
  overrides?: LocalResolverOptions,
): LocalResolverOptions {
  return {
    ...(defaults.seedIdentifiers !== undefined
      ? { seedIdentifiers: defaults.seedIdentifiers }
      : {}),
    ...(defaults.seedMembers !== undefined
      ? { seedMembers: defaults.seedMembers }
      : {}),
    ...(defaults.maxChainLength !== undefined
      ? { maxChainLength: defaults.maxChainLength }
      : {}),
    ...(overrides?.seedIdentifiers !== undefined
      ? { seedIdentifiers: overrides.seedIdentifiers }
      : {}),
    ...(overrides?.seedMembers !== undefined
      ? { seedMembers: overrides.seedMembers }
      : {}),
    ...(overrides?.maxChainLength !== undefined
      ? { maxChainLength: overrides.maxChainLength }
      : {}),
  };
}

class DefaultLocalResolver implements LocalResolver {
  constructor(private readonly defaults: LocalResolverOptions = {}) {}

  analyze(input: AnalyzeInput): FileAliasAnalysis {
    const options = normalizeOptions(
      mergeOptions(this.defaults, input.options),
    );
    const seeds = new Set(options.seedIdentifiers);
    const seedMembers = new Set(options.seedMembers);

    const sourceFile = input.sourceFile;
    const scopes = buildScopeTable(sourceFile);
    const wrappers = detectFunctionAliases(sourceFile, scopes, {
      seedIdentifiers: seeds,
      seedMembers,
    });
    const mutable = collectAliasBindings(sourceFile, scopes, wrappers);
    const graph = mutable.freeze(scopes);

    return {
      fileName: input.fileName ?? sourceFile.fileName,
      graph,
      wrappers,
      seeds,
      seedMembers,
      maxChainLength: options.maxChainLength,
    };
  }

  resolve(input: ResolveIdentifierInput): ResolutionResult {
    const { analysis, name, position } = input;
    const location =
      input.location ??
      ({
        line: 1,
        column: 1,
        endLine: 1,
        endColumn: 1,
        start: position,
        end: position,
      } as const);

    return resolveIdentifier({
      originalIdentifier: name,
      position,
      location,
      graph: analysis.graph,
      seeds: analysis.seeds,
      seedMembers: analysis.seedMembers,
      maxChainLength: analysis.maxChainLength,
    });
  }
}

export function createLocalResolver(
  options?: LocalResolverOptions,
): LocalResolver {
  return new DefaultLocalResolver(options ?? {});
}

export const localResolverFactory: LocalResolverFactory = {
  createLocalResolver,
};

/** Convenience: analyze + resolve in one call for a single use site. */
export function resolveLocalIdentifier(input: {
  sourceFile: import("typescript").SourceFile;
  name: string;
  position: number;
  options?: LocalResolverOptions;
}): ResolutionResult {
  const resolver = createLocalResolver(input.options);
  const analysis = resolver.analyze({
    sourceFile: input.sourceFile,
    ...(input.options !== undefined ? { options: input.options } : {}),
  });
  return resolver.resolve({
    analysis,
    name: input.name,
    position: input.position,
    location: locationAt(input.sourceFile, input.position),
  });
}
