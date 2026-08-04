import path from "node:path";
import {
  createContextAnalyzer,
  type ContextAnalyzer,
  type ResolvedTranslationUsage,
  type SourceLocation,
  type UsageResolveInput,
} from "../src/index.js";

let seq = 0;

const LOC: SourceLocation = {
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 8,
  start: 0,
  end: 8,
};

export function project(files: Record<string, string>): {
  root: string;
  analyzer: ContextAnalyzer;
  abs: (...parts: string[]) => string;
  usage: (
    partial: Partial<UsageResolveInput> & { key: string },
  ) => UsageResolveInput;
  resolve: (
    partial: Partial<UsageResolveInput> & { key: string },
  ) => ResolvedTranslationUsage;
} {
  const root = path.resolve(`/virtual-context-${++seq}`);
  const store = new Map<string, string>();
  const dirs = new Set<string>([root]);

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.resolve(root, rel);
    store.set(abs, content);
    let dir = path.dirname(abs);
    while (dir.startsWith(root) || dir === root) {
      dirs.add(dir);
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  const analyzer = createContextAnalyzer({
    root,
    fileExists: (abs) => store.has(path.normalize(abs)) || dirs.has(path.normalize(abs)),
    readFile: (abs) => store.get(path.normalize(abs)),
    readDir: (abs) => {
      const normalized = path.normalize(abs);
      if (!dirs.has(normalized) && !store.has(normalized)) {
        // list children of virtual dirs
      }
      const prefix = normalized.endsWith(path.sep)
        ? normalized
        : normalized + path.sep;
      const names = new Set<string>();
      for (const key of [...store.keys(), ...dirs]) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const name = rest.split(path.sep)[0];
        if (name) names.add(name);
      }
      return [...names];
    },
  });

  const abs = (...parts: string[]) => path.resolve(root, ...parts);

  const usage = (
    partial: Partial<UsageResolveInput> & { key: string },
  ): UsageResolveInput => ({
    absolutePath: abs("src/App.tsx"),
    relativePath: "src/App.tsx",
    location: LOC,
    ...partial,
  });

  return {
    root,
    analyzer,
    abs,
    usage,
    resolve(partial) {
      analyzer.analyze();
      return analyzer.resolveUsage(usage(partial));
    },
  };
}
