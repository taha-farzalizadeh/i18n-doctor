/**
 * Discover and statically parse i18n configuration files.
 * Results are cached by absolute path + content fingerprint.
 * Extractors are gated by filename to avoid cross-framework false positives.
 */

import fs from "node:fs";
import path from "node:path";
import { createAstEngine } from "@i18n-doctor/ast";
import type {
  ConfigAnalyzer,
  ContextAnalyzerOptions,
  TranslationConfig,
} from "../api/types.js";
import { CONFIG_CANDIDATES } from "./config-candidates.js";
import { extractI18nextConfigs } from "./extractors/i18next.js";
import { extractNextConfig } from "./extractors/next-config.js";
import { extractNextI18nextConfigs } from "./extractors/next-i18next.js";
import { extractNextIntlConfigs } from "./extractors/next-intl.js";
import {
  buildConfig,
  type ConfigDraft,
  hasAnySetting,
} from "./extractors/shared.js";
import {
  extractNuxtI18nConfigs,
  extractVueI18nConfigs,
} from "./extractors/vue-nuxt.js";
import { relativeToRoot, resolveAgainstRoot } from "./location.js";

const JS_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
]);

export interface DiscoverResult {
  readonly paths: readonly string[];
  readonly truncated: boolean;
  readonly totalFound: number;
}

export function createConfigAnalyzer(): ConfigAnalyzer {
  const ast = createAstEngine({
    cache: true,
    cacheSize: 256,
    setParentNodes: true,
  });
  const fileCache = new Map<
    string,
    { fingerprint: string; configs: TranslationConfig[] }
  >();

  return {
    discover(options) {
      return discoverConfigPathsDetailed(options).paths;
    },
    analyzeFile(absolutePath, options) {
      const readFile = options.readFile ?? defaultReadFile;
      const text = readFile(absolutePath);
      if (text === undefined) {
        return [];
      }
      const fingerprint = `${text.length}:${simpleHash(text)}`;
      const cached = fileCache.get(absolutePath);
      if (cached && cached.fingerprint === fingerprint) {
        return cached.configs;
      }

      const ext = path.extname(absolutePath).toLowerCase();
      if (!JS_EXT.has(ext)) {
        fileCache.set(absolutePath, { fingerprint, configs: [] });
        return [];
      }

      let sourceFile;
      try {
        sourceFile = ast.parse({
          fileName: absolutePath,
          sourceText: text,
        }).sourceFile;
      } catch {
        fileCache.set(absolutePath, { fingerprint, configs: [] });
        return [];
      }

      const base = path.basename(absolutePath);
      const rel = relativeToRoot(options.root, absolutePath);
      const packageRoot = inferPackageRoot(absolutePath, options);
      const drafts = runExtractors(sourceFile, base);

      const configs: TranslationConfig[] = [];
      let index = 0;
      for (const draft of dedupeDrafts(drafts)) {
        if (!hasAnySetting(draft)) continue;
        configs.push(
          buildConfig({
            absolutePath,
            relativePath: rel,
            ...(packageRoot !== undefined ? { packageRoot } : {}),
            index: index++,
            draft,
          }),
        );
      }

      // Deterministic order
      configs.sort((a, b) => a.id.localeCompare(b.id));
      fileCache.set(absolutePath, { fingerprint, configs });
      return configs;
    },
  };
}

function runExtractors(
  sourceFile: import("typescript").SourceFile,
  basename: string,
): ConfigDraft[] {
  const drafts: ConfigDraft[] = [];

  const isNextI18next = basename.startsWith("next-i18next.config");
  const isNextConfig = basename.startsWith("next.config");
  const isNuxtConfig =
    basename.startsWith("nuxt.config") || basename.startsWith("i18n.config");
  const isRoutingOrRequest =
    basename === "routing.ts" ||
    basename === "routing.js" ||
    basename === "request.ts" ||
    basename === "request.js" ||
    basename === "config.ts" ||
    basename === "config.js";
  const isI18nModule =
    basename.startsWith("i18n.") ||
    basename === "index.ts" ||
    basename === "index.js";

  if (isNextI18next) {
    drafts.push(
      ...extractNextI18nextConfigs(sourceFile, { filename: basename }),
    );
    return drafts;
  }

  if (isNextConfig) {
    drafts.push(...extractNextConfig(sourceFile));
    // next.config may wrap next-intl plugin — still check for i18n block only
    return drafts;
  }

  if (isNuxtConfig) {
    drafts.push(...extractNuxtI18nConfigs(sourceFile));
    if (basename.startsWith("i18n.config")) {
      drafts.push(...extractVueI18nConfigs(sourceFile));
    }
    return drafts;
  }

  // Generic i18n modules / routing / request
  drafts.push(...extractI18nextConfigs(sourceFile));
  drafts.push(...extractVueI18nConfigs(sourceFile));

  if (isRoutingOrRequest || isI18nModule) {
    drafts.push(
      ...extractNextIntlConfigs(sourceFile, {
        requireSignal: !isRoutingOrRequest,
      }),
    );
  } else {
    // Only when next-intl helpers/imports present
    drafts.push(
      ...extractNextIntlConfigs(sourceFile, { requireSignal: true }),
    );
  }

  return drafts;
}

function dedupeDrafts(drafts: readonly ConfigDraft[]): ConfigDraft[] {
  const seen = new Set<string>();
  const out: ConfigDraft[] = [];
  for (const d of drafts) {
    const key = [
      d.kind,
      d.library,
      JSON.stringify(d.defaultNS ?? null),
      JSON.stringify(d.defaultLocale ?? null),
      JSON.stringify(d.ns ?? null),
      JSON.stringify(d.supportedLocales ?? null),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

export function discoverConfigPaths(
  options: ContextAnalyzerOptions,
): string[] {
  return discoverConfigPathsDetailed(options).paths as string[];
}

export function discoverConfigPathsDetailed(
  options: ContextAnalyzerOptions,
): DiscoverResult {
  const fileExists = options.fileExists ?? defaultFileExists;
  const roots = options.packageRoots?.length
    ? options.packageRoots.map((p) => resolveAgainstRoot(options.root, p))
    : discoverPackageRoots(options);

  const found = new Set<string>();

  for (const packageRoot of roots) {
    for (const candidate of CONFIG_CANDIDATES) {
      const abs = path.resolve(packageRoot, candidate.relativePath);
      if (fileExists(abs)) {
        found.add(path.normalize(abs));
      }
    }
  }

  if (options.configPaths) {
    for (const p of options.configPaths) {
      const abs = resolveAgainstRoot(options.root, p);
      if (fileExists(abs)) {
        found.add(path.normalize(abs));
      }
    }
  }

  const sorted = [...found].sort((a, b) => a.localeCompare(b));
  const max = options.maxConfigs ?? 64;
  return {
    paths: sorted.slice(0, max),
    truncated: sorted.length > max,
    totalFound: sorted.length,
  };
}

export function discoverPackageRoots(
  options: ContextAnalyzerOptions,
): string[] {
  const root = path.resolve(options.root);
  const fileExists = options.fileExists ?? defaultFileExists;
  const readFile = options.readFile ?? defaultReadFile;
  const readDir = options.readDir ?? defaultReadDir;

  const roots = new Set<string>([root]);

  const pkgPath = path.join(root, "package.json");
  if (fileExists(pkgPath)) {
    const text = readFile(pkgPath);
    if (text) {
      for (const pattern of readWorkspacePatterns(text)) {
        for (const dir of expandWorkspacePattern(
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
    }
  }

  for (const base of ["packages", "apps", "services"]) {
    const baseDir = path.join(root, base);
    const entries = readDir(baseDir);
    if (!entries) continue;
    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const dir = path.join(baseDir, name);
      if (fileExists(path.join(dir, "package.json"))) {
        roots.add(path.normalize(dir));
      }
    }
  }

  return [...roots].sort((a, b) => a.localeCompare(b));
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

function expandWorkspacePattern(
  root: string,
  pattern: string,
  fileExists: (p: string) => boolean,
  readDir: (p: string) => readonly string[] | undefined,
): string[] {
  if (pattern.endsWith("/*")) {
    const base = path.join(root, pattern.slice(0, -2));
    const entries = readDir(base);
    if (!entries) return [];
    return entries
      .filter((n) => !n.startsWith("."))
      .map((n) => path.join(base, n))
      .filter((dir) => fileExists(dir));
  }
  const abs = path.join(root, pattern);
  return fileExists(abs) ? [abs] : [];
}

function inferPackageRoot(
  absolutePath: string,
  options: ContextAnalyzerOptions,
): string | undefined {
  const roots = options.packageRoots?.length
    ? options.packageRoots.map((p) => resolveAgainstRoot(options.root, p))
    : undefined;
  if (!roots) return undefined;
  const normalized = path.normalize(absolutePath);
  let best: string | undefined;
  for (const r of roots) {
    const nr = path.normalize(r);
    if (normalized === nr || normalized.startsWith(nr + path.sep)) {
      if (!best || nr.length > best.length) best = nr;
    }
  }
  return best;
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

function simpleHash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
