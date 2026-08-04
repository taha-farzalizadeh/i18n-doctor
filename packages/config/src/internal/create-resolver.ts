import fs from "node:fs";
import path from "node:path";
import type { EffectiveConfigResolverFactory } from "../api/resolver.js";
import type {
  ConfigFragment,
  EffectiveConfig,
  EffectiveConfigResolver,
  ResolveEffectiveOptions,
  UserConfig,
} from "../api/types.js";
import { createConfigLoader } from "./create-loader.js";
import { defaultsFragment, mergeFragments } from "./merge.js";
import { validateUserConfig } from "./validate.js";

class DefaultEffectiveConfigResolver implements EffectiveConfigResolver {
  resolve(options: ResolveEffectiveOptions): EffectiveConfig {
    const root = path.resolve(options.root);
    const packageRoot = options.packageRoot
      ? path.resolve(options.packageRoot)
      : undefined;

    const fragments: ConfigFragment[] = [defaultsFragment()];

    const rootLoader = createConfigLoader({
      root,
      ...(options.fileExists !== undefined
        ? { fileExists: options.fileExists }
        : {}),
      ...(options.readFile !== undefined ? { readFile: options.readFile } : {}),
      ...(options.configPath !== undefined
        ? { configPath: options.configPath }
        : {}),
    });

    const rootLoaded = options.loaded ?? rootLoader.load();
    for (const f of rootLoaded.fragments) {
      fragments.push(f);
    }

    // Package-local layers elevate to package-config so they beat root config-file
    if (packageRoot && packageRoot !== root) {
      const pkgLoader = createConfigLoader({
        root,
        ...(options.fileExists !== undefined
          ? { fileExists: options.fileExists }
          : {}),
        ...(options.readFile !== undefined
          ? { readFile: options.readFile }
          : {}),
      });
      const pkgLoaded = pkgLoader.load({ packageRoot });
      for (const f of pkgLoaded.fragments) {
        fragments.push({
          ...f,
          source:
            f.source === "config-file" || f.source === "package-json"
              ? "package-config"
              : f.source,
        });
      }
    }

    // CLI overrides — validated, highest precedence
    if (options.cli && Object.keys(options.cli).length > 0) {
      const validated = validateUserConfig(options.cli, "<cli>");
      fragments.push({
        source: "cli",
        config: validated.config,
        diagnostics: validated.diagnostics,
      });
    }

    return mergeFragments(root, packageRoot, fragments);
  }

  resolveMonorepo(options: {
    readonly root: string;
    readonly packageRoots?: readonly string[];
    readonly cli?: UserConfig;
    readonly fileExists?: (absolutePath: string) => boolean;
    readonly readFile?: (absolutePath: string) => string | undefined;
    readonly readDir?: (absolutePath: string) => readonly string[] | undefined;
  }): readonly EffectiveConfig[] {
    const root = path.resolve(options.root);

    // Shared loader — root fragments parsed once
    const sharedLoader = createConfigLoader({
      root,
      ...(options.fileExists !== undefined
        ? { fileExists: options.fileExists }
        : {}),
      ...(options.readFile !== undefined ? { readFile: options.readFile } : {}),
    });
    const rootLoaded = sharedLoader.load();

    const roots = options.packageRoots?.length
      ? options.packageRoots.map((p) =>
          path.isAbsolute(p) ? path.normalize(p) : path.resolve(root, p),
        )
      : discoverPackageRoots(root, options, rootLoaded);

    const results = roots.map((packageRoot) =>
      this.resolve({
        root,
        packageRoot,
        loaded: rootLoaded,
        ...(options.cli !== undefined ? { cli: options.cli } : {}),
        ...(options.fileExists !== undefined
          ? { fileExists: options.fileExists }
          : {}),
        ...(options.readFile !== undefined
          ? { readFile: options.readFile }
          : {}),
      }),
    );

    return [...results].sort((a, b) =>
      (a.packageRoot ?? a.root).localeCompare(b.packageRoot ?? b.root),
    );
  }
}

function discoverPackageRoots(
  root: string,
  options: {
    readonly fileExists?: (absolutePath: string) => boolean;
    readonly readFile?: (absolutePath: string) => string | undefined;
    readonly readDir?: (absolutePath: string) => readonly string[] | undefined;
  },
  rootLoaded?: { fragments: readonly ConfigFragment[] },
): string[] {
  const fileExists = options.fileExists ?? defaultFileExists;
  const readFile = options.readFile ?? defaultReadFile;
  const readDir = options.readDir ?? defaultReadDir;
  const roots = new Set<string>([root]);

  // Config `packages` field (from root fragments) takes priority over heuristics
  const packagesFromConfig = rootLoaded?.fragments
    .flatMap((f) => f.config.packages ?? [])
    .filter(Boolean);
  const patterns: string[] = [];

  if (packagesFromConfig && packagesFromConfig.length > 0) {
    patterns.push(...packagesFromConfig);
  } else {
    const pkgPath = path.join(root, "package.json");
    if (fileExists(pkgPath)) {
      const text = readFile(pkgPath);
      if (text) patterns.push(...readWorkspacePatterns(text));
    }
    // Heuristic folders when no workspace field
    if (patterns.length === 0) {
      patterns.push("packages/*", "apps/*", "services/*");
    }
  }

  for (const pattern of patterns) {
    for (const dir of expandPackagePattern(
      root,
      pattern,
      fileExists,
      readDir,
    )) {
      if (fileExists(path.join(dir, "package.json"))) {
        roots.add(path.normalize(dir));
      }
    }
  }

  return [...roots].sort((a, b) => a.localeCompare(b));
}

function expandPackagePattern(
  root: string,
  pattern: string,
  fileExists: (p: string) => boolean,
  readDir: (p: string) => readonly string[] | undefined,
): string[] {
  const trimmed = pattern.trim().replace(/\\/g, "/");
  if (!trimmed) return [];

  // Exact directory
  if (!trimmed.includes("*")) {
    const abs = path.resolve(root, trimmed);
    return fileExists(abs) ? [abs] : [];
  }

  // packages/* or apps/*
  if (trimmed.endsWith("/*") && !trimmed.slice(0, -2).includes("*")) {
    const base = path.join(root, trimmed.slice(0, -2));
    const entries = readDir(base);
    if (!entries) return [];
    return entries
      .filter((n) => !n.startsWith("."))
      .map((n) => path.join(base, n))
      .filter((dir) => fileExists(dir));
  }

  // packages/** — one level of nesting for safety
  if (trimmed.endsWith("/**")) {
    const base = path.join(root, trimmed.slice(0, -3));
    const entries = readDir(base);
    if (!entries) return [];
    const out: string[] = [];
    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const dir = path.join(base, name);
      if (fileExists(dir)) out.push(dir);
      const nested = readDir(dir);
      if (!nested) continue;
      for (const child of nested) {
        if (child.startsWith(".")) continue;
        const childDir = path.join(dir, child);
        if (fileExists(childDir)) out.push(childDir);
      }
    }
    return out;
  }

  return [];
}

function readWorkspacePatterns(packageJsonText: string): string[] {
  try {
    const json = JSON.parse(packageJsonText) as {
      workspaces?: string[] | { packages?: string[] };
    };
    if (Array.isArray(json.workspaces)) return json.workspaces;
    if (json.workspaces && Array.isArray(json.workspaces.packages)) {
      return json.workspaces.packages;
    }
  } catch {
    // ignore
  }
  return [];
}

function defaultFileExists(absolutePath: string): boolean {
  try {
    return fs.existsSync(absolutePath);
  } catch {
    return false;
  }
}

function defaultReadFile(absolutePath: string): string | undefined {
  try {
    return fs.readFileSync(absolutePath, "utf8");
  } catch {
    return undefined;
  }
}

function defaultReadDir(absolutePath: string): readonly string[] | undefined {
  try {
    return fs.readdirSync(absolutePath);
  } catch {
    return undefined;
  }
}

export function createEffectiveConfigResolver(): EffectiveConfigResolver {
  return new DefaultEffectiveConfigResolver();
}

export const effectiveConfigResolverFactory: EffectiveConfigResolverFactory = {
  createEffectiveConfigResolver,
};
