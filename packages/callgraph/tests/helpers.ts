import path from "node:path";
import {
  createCallGraphAnalyzer,
  type CallGraphAnalyzer,
  type FileCallAnalysis,
} from "../src/index.js";

let seq = 0;

export function project(
  files: Record<string, string>,
  options: { seeds?: Parameters<typeof createCallGraphAnalyzer>[0]["seeds"] } = {},
): {
  root: string;
  analyzer: CallGraphAnalyzer;
  abs: (...parts: string[]) => string;
  analyze: (...rels: string[]) => FileCallAnalysis | ReturnType<CallGraphAnalyzer["analyzeFiles"]>;
} {
  const root = path.resolve(`/virtual-callgraph-${++seq}`);
  const store = new Map<string, string>();
  for (const [rel, content] of Object.entries(files)) {
    store.set(path.resolve(root, rel), content);
  }

  const analyzer = createCallGraphAnalyzer({
    root,
    ...(options.seeds !== undefined ? { seeds: options.seeds } : {}),
    fileExists: (abs) => store.has(path.normalize(abs)),
    readFile: (abs) => store.get(path.normalize(abs)),
  });

  const abs = (...parts: string[]) => path.resolve(root, ...parts);

  return {
    root,
    analyzer,
    abs,
    analyze(...rels) {
      if (rels.length === 1) {
        return analyzer.analyzeFile({ filePath: abs(rels[0]!) });
      }
      return analyzer.analyzeFiles(rels.map((r) => abs(r)));
    },
  };
}
