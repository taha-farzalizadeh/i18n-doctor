import fs from "node:fs";
import path from "node:path";
import type { ConfigLoaderFactory } from "../api/loader.js";
import type {
  ConfigFragment,
  ConfigLoader,
  ConfigLoaderOptions,
  LoadedConfig,
} from "../api/types.js";
import { CONFIG_FILENAMES } from "./defaults.js";
import { parseJsConfig } from "./parse-js.js";
import { parseJsonConfig } from "./parse-json.js";

class DefaultConfigLoader implements ConfigLoader {
  private readonly options: ConfigLoaderOptions;
  private readonly root: string;
  private readonly fileExists: (absolutePath: string) => boolean;
  private readonly readFile: (absolutePath: string) => string | undefined;
  private readonly cache = new Map<string, ConfigFragment>();

  constructor(options: ConfigLoaderOptions) {
    this.options = options;
    this.root = path.resolve(options.root);
    this.fileExists = options.fileExists ?? defaultFileExists;
    this.readFile = options.readFile ?? defaultReadFile;
  }

  load(options?: { packageRoot?: string }): LoadedConfig {
    const scopeRoot = options?.packageRoot
      ? path.resolve(options.packageRoot)
      : this.root;

    const fragments: ConfigFragment[] = [];
    const seen = new Set<string>();
    const toRel = (abs: string) =>
      (path.relative(this.root, abs) || path.basename(abs))
        .split(path.sep)
        .join("/");

    // 1) package.json "i18n-doctor" at scope root
    if (this.options.readPackageJson !== false) {
      const pkgPath = path.join(scopeRoot, "package.json");
      if (this.fileExists(pkgPath)) {
        const frag = this.loadFile(pkgPath);
        if (
          Object.keys(frag.config).length > 0 ||
          frag.diagnostics.some((d) => d.severity === "error")
        ) {
          fragments.push({ ...frag, source: "package-json" });
          seen.add(path.normalize(pkgPath));
        }
      }
    }

    // 2) Explicit configPath — ESLint-style: skips auto-discovery
    if (this.options.configPath) {
      const abs = path.isAbsolute(this.options.configPath)
        ? path.normalize(this.options.configPath)
        : path.resolve(this.root, this.options.configPath);
      const rel = toRel(abs);
      if (!this.fileExists(abs)) {
        fragments.push({
          source: "config-file",
          path: rel,
          config: {},
          diagnostics: [
            {
              code: "config-not-found",
              severity: "error",
              message: `Config file not found: ${rel}`,
              path: rel,
              hint: "Pass a path relative to the workspace root, or an absolute path",
            },
          ],
        });
      } else if (!seen.has(abs)) {
        fragments.push(this.loadFile(abs));
        seen.add(abs);
      }
    } else {
      // 3) Discover standard filenames (first match in CONFIG_FILENAMES order)
      for (const name of CONFIG_FILENAMES) {
        const abs = path.join(scopeRoot, name);
        const norm = path.normalize(abs);
        if (seen.has(norm) || !this.fileExists(abs)) continue;
        fragments.push(this.loadFile(abs));
        seen.add(norm);
        break;
      }
    }

    const diagnostics = fragments.flatMap((f) => f.diagnostics);
    const primary = fragments.find(
      (f) => f.source === "config-file" || f.source === "package-config",
    );

    return {
      root: scopeRoot,
      ...(primary?.path !== undefined ? { configPath: primary.path } : {}),
      fragments,
      diagnostics,
    };
  }

  loadFile(absolutePath: string): ConfigFragment {
    const norm = path.normalize(absolutePath);
    const cached = this.cache.get(norm);
    if (cached) return cached;

    const text = this.readFile(norm);
    const relativeHint = (
      path.relative(this.root, norm) || path.basename(norm)
    )
      .split(path.sep)
      .join("/");

    if (text === undefined) {
      const frag: ConfigFragment = {
        source: sourceKindForPath(norm, this.root),
        path: relativeHint,
        config: {},
        diagnostics: [
          {
            code: "config-unreadable",
            severity: "error",
            message: `Unable to read config file: ${relativeHint}`,
            path: relativeHint,
          },
        ],
      };
      this.cache.set(norm, frag);
      return frag;
    }

    const ext = path.extname(norm).toLowerCase();
    const base = path.basename(norm);

    if (base === "package.json") {
      let parsedJson: Record<string, unknown> | undefined;
      try {
        parsedJson = JSON.parse(text) as Record<string, unknown>;
      } catch (err) {
        const frag: ConfigFragment = {
          source: "package-json",
          path: relativeHint,
          config: {},
          diagnostics: [
            {
              code: "config-json-parse-error",
              severity: "error",
              message: err instanceof Error ? err.message : String(err),
              path: relativeHint,
            },
          ],
        };
        this.cache.set(norm, frag);
        return frag;
      }
      if (!("i18n-doctor" in parsedJson)) {
        const empty: ConfigFragment = {
          source: "package-json",
          path: relativeHint,
          config: {},
          diagnostics: [],
        };
        this.cache.set(norm, empty);
        return empty;
      }
      const parsed = parseJsonConfig(text, relativeHint);
      const frag: ConfigFragment = {
        source: "package-json",
        path: relativeHint,
        config: parsed.config,
        diagnostics: parsed.diagnostics,
      };
      this.cache.set(norm, frag);
      return frag;
    }

    const parsed =
      ext === ".json"
        ? parseJsonConfig(text, relativeHint)
        : parseJsConfig(text, relativeHint);

    const frag: ConfigFragment = {
      source: sourceKindForPath(norm, this.root),
      path: relativeHint,
      config: parsed.config,
      diagnostics: parsed.diagnostics,
    };
    this.cache.set(norm, frag);
    return frag;
  }
}

function sourceKindForPath(
  absolutePath: string,
  workspaceRoot: string,
): ConfigFragment["source"] {
  const base = path.basename(absolutePath);
  if (base === "package.json") return "package-json";
  const rel = path.relative(workspaceRoot, absolutePath);
  if (
    rel.includes(path.sep) &&
    (CONFIG_FILENAMES as readonly string[]).includes(base)
  ) {
    return "package-config";
  }
  return "config-file";
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

export function createConfigLoader(
  options: ConfigLoaderOptions,
): ConfigLoader {
  return new DefaultConfigLoader(options);
}

export const configLoaderFactory: ConfigLoaderFactory = {
  createConfigLoader,
};
