import path from "node:path";
import {
  createConfigLoader,
  createEffectiveConfigResolver,
  type ConfigLoader,
  type EffectiveConfigResolver,
} from "../src/index.js";

let seq = 0;

export function project(files: Record<string, string>): {
  root: string;
  loader: ConfigLoader;
  resolver: EffectiveConfigResolver;
  abs: (...parts: string[]) => string;
} {
  const root = path.resolve(`/virtual-config-${++seq}`);
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

  const fileExists = (abs: string) =>
    store.has(path.normalize(abs)) || dirs.has(path.normalize(abs));
  const readFile = (abs: string) => store.get(path.normalize(abs));
  const readDir = (abs: string) => {
    const normalized = path.normalize(abs);
    const prefix = normalized.endsWith(path.sep)
      ? normalized
      : normalized + path.sep;
    const names = new Set<string>();
    for (const key of [...store.keys(), ...dirs]) {
      if (!key.startsWith(prefix)) continue;
      const name = key.slice(prefix.length).split(path.sep)[0];
      if (name) names.add(name);
    }
    return [...names];
  };

  const loader = createConfigLoader({ root, fileExists, readFile });
  const resolver = createEffectiveConfigResolver();

  return {
    root,
    loader,
    resolver: {
      resolve(options) {
        return resolver.resolve({
          ...options,
          root: options.root ?? root,
          fileExists,
          readFile,
        });
      },
      resolveMonorepo(options) {
        return resolver.resolveMonorepo({
          ...options,
          root: options.root ?? root,
          fileExists,
          readFile,
          readDir,
        });
      },
    },
    abs: (...parts: string[]) => path.resolve(root, ...parts),
  };
}
