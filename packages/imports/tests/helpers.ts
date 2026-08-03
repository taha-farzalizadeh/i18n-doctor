import path from "node:path";
import {
  createImportResolver,
  type ImportResolver,
  type ModuleGraph,
  type SymbolResolution,
} from "../src/index.js";

let projectSeq = 0;

export function virtualProject(
  files: Record<string, string>,
  options: {
    aliases?: Record<string, string>;
    tsconfig?: string;
    rootName?: string;
  } = {},
): {
  root: string;
  resolver: ImportResolver;
  graph: ModuleGraph;
  abs: (...parts: string[]) => string;
} {
  // Unique roots avoid cross-test cache collisions on path keys.
  const root = path.resolve(
    `/virtual-project-${options.rootName ?? String(++projectSeq)}`,
  );
  const store = new Map<string, string>();
  for (const [rel, content] of Object.entries(files)) {
    store.set(path.resolve(root, rel), content);
  }
  if (options.tsconfig !== undefined) {
    store.set(path.resolve(root, "tsconfig.json"), options.tsconfig);
  }

  const resolver = createImportResolver({
    root,
    ...(options.aliases !== undefined ? { aliases: options.aliases } : {}),
    fileExists: (abs) => store.has(path.normalize(abs)),
    readFile: (abs) => store.get(path.normalize(abs)),
  });

  const entries = Object.keys(files)
    .filter((f) => /\.(ts|tsx|js|jsx|mts|cts)$/.test(f))
    .map((f) => path.resolve(root, f));

  const graph = resolver.buildGraph({
    entryFiles: entries,
    followDepth: 8,
  });

  return {
    root,
    resolver,
    graph,
    abs: (...parts) => path.resolve(root, ...parts),
  };
}

export function chainKinds(result: SymbolResolution): string[] {
  return result.resolutionChain.map((s) => s.kind);
}
