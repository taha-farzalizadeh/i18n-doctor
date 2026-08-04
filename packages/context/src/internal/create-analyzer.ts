import path from "node:path";
import type { ContextAnalyzerFactory } from "../api/analyzer.js";
import type {
  AnalyzeContextInput,
  ContextAnalyzer,
  ContextAnalyzerOptions,
  ContextWarning,
  ResolvedTranslationUsage,
  ResolveUsageOptions,
  ResolutionSource,
  TranslationConfig,
  TranslationContext,
  UsageResolveInput,
} from "../api/types.js";
import {
  createConfigAnalyzer,
  discoverConfigPathsDetailed,
  discoverPackageRoots,
} from "./config-analyzer.js";
import { createLocaleResolver } from "./locale-resolver.js";
import { normalizeLibraryId } from "./library-mode.js";
import {
  relativeToRoot,
  resolveAgainstRoot,
  roundConfidence,
} from "./location.js";
import { mergeConfigs } from "./merge-config.js";
import { createNamespaceResolver } from "./namespace-resolver.js";

class DefaultContextAnalyzer implements ContextAnalyzer {
  private readonly options: ContextAnalyzerOptions;
  private readonly root: string;
  private readonly configAnalyzer = createConfigAnalyzer();
  private readonly namespaceResolver = createNamespaceResolver();
  private readonly localeResolver = createLocaleResolver();
  private readonly contextCache = new Map<string, TranslationContext>();
  private lastContext: TranslationContext | undefined;

  constructor(options: ContextAnalyzerOptions) {
    this.options = options;
    this.root = path.resolve(options.root);
  }

  analyze(input?: AnalyzeContextInput): TranslationContext {
    const packageRoot = input?.packageRoot
      ? resolveAgainstRoot(this.root, input.packageRoot)
      : this.root;
    const cacheKey = path.normalize(packageRoot);
    const cached = this.contextCache.get(cacheKey);
    if (cached) {
      this.lastContext = cached;
      return cached;
    }

    const t0 = now();
    const warnings: ContextWarning[] = [];
    const configs: TranslationConfig[] = [];

    const discoverStart = now();

    // Package-local configs
    const localDiscover = discoverConfigPathsDetailed({
      ...this.options,
      root: this.root,
      packageRoots: [packageRoot],
    });

    // Root configs as fallback when analyzing a monorepo package
    const rootDiscover =
      packageRoot !== this.root
        ? discoverConfigPathsDetailed({
            ...this.options,
            root: this.root,
            packageRoots: [this.root],
          })
        : undefined;

    const discoverMs = now() - discoverStart;

    if (localDiscover.truncated || rootDiscover?.truncated) {
      warnings.push({
        code: "config-truncated",
        message: `Config discovery truncated to ${this.options.maxConfigs ?? 64} files (found ${(localDiscover.totalFound + (rootDiscover?.totalFound ?? 0))} candidates)`,
      });
    }

    const analyzeStart = now();
    const seenPaths = new Set<string>();

    const ingest = (
      paths: readonly string[],
      opts: { packageRoots: string[]; confidenceBoost?: number },
    ): void => {
      for (const abs of paths) {
        const norm = path.normalize(abs);
        if (seenPaths.has(norm)) continue;
        seenPaths.add(norm);
        try {
          const extracted = this.configAnalyzer.analyzeFile(abs, {
            ...this.options,
            root: this.root,
            packageRoots: opts.packageRoots,
          });
          for (const c of extracted) {
            if (opts.confidenceBoost) {
              configs.push({
                ...c,
                confidence: roundConfidence(
                  Math.min(1, c.confidence + opts.confidenceBoost),
                ),
              });
            } else {
              configs.push(c);
            }
          }
        } catch (err) {
          warnings.push({
            code: "config-parse-error",
            message: err instanceof Error ? err.message : String(err),
            path: relativeToRoot(this.root, abs),
          });
        }
      }
    };

    // Package-local configs win conflicts via confidence boost
    ingest(localDiscover.paths, {
      packageRoots: [packageRoot, this.root],
      confidenceBoost: 0.05,
    });
    if (rootDiscover) {
      ingest(rootDiscover.paths, { packageRoots: [this.root] });
    }

    // Stable config order
    configs.sort(
      (a, b) =>
        a.relativePath.localeCompare(b.relativePath) ||
        a.id.localeCompare(b.id),
    );

    const effective = mergeConfigs(configs, this.options.preferredLibrary);
    for (const c of effective.conflicts) {
      warnings.push({
        code: "config-conflict",
        message: c.message,
      });
    }

    const analyzeMs = now() - analyzeStart;
    const context: TranslationContext = {
      root: this.root,
      ...(packageRoot !== this.root ? { packageRoot } : {}),
      configs,
      effective,
      warnings,
      timings: {
        discoverMs,
        analyzeMs,
        totalMs: now() - t0,
      },
    };

    this.contextCache.set(cacheKey, context);
    this.lastContext = context;
    return context;
  }

  analyzeMonorepo(): readonly TranslationContext[] {
    const roots = this.options.packageRoots?.length
      ? this.options.packageRoots.map((p) => resolveAgainstRoot(this.root, p))
      : discoverPackageRoots({ ...this.options, root: this.root });

    return roots.map((packageRoot) => this.analyze({ packageRoot }));
  }

  resolveNamespace(input: UsageResolveInput, options?: ResolveUsageOptions) {
    const ctx = options?.context ?? this.ensureContext();
    return this.namespaceResolver.resolve(input, ctx.effective);
  }

  resolveLocale(input: UsageResolveInput, options?: ResolveUsageOptions) {
    const ctx = options?.context ?? this.ensureContext();
    return this.localeResolver.resolve(input, ctx.effective);
  }

  resolveUsage(
    input: UsageResolveInput,
    options?: ResolveUsageOptions,
  ): ResolvedTranslationUsage {
    const ctx = options?.context ?? this.ensureContext();
    const ns = this.namespaceResolver.resolve(input, ctx.effective);
    const loc = this.localeResolver.resolve(input, ctx.effective);

    const chain = uniqueSources([
      ...ns.resolutionChain,
      ...loc.resolutionChain,
    ]);

    // Namespace/key confidence is primary. Locale is orthogonal metadata —
    // only an explicitly provided (call-site) locale may tighten the score.
    const confidence = roundConfidence(
      loc.resolutionSource === "call-site"
        ? Math.min(ns.confidence, loc.confidence)
        : ns.confidence,
    );
    const library = normalizeLibraryId(input.library);

    const evidenceParts = [
      `ns=${ns.resolutionSource}`,
      `locale=${loc.resolutionSource}`,
      ...(ns.namespace !== undefined ? [`namespace=${ns.namespace}`] : []),
      ...(loc.locale !== undefined ? [`localeValue=${loc.locale}`] : []),
      ...(ns.resolvedKey !== input.key
        ? [`resolvedKey=${ns.resolvedKey}`]
        : []),
    ];

    return {
      originalKey: input.key,
      resolvedKey: ns.resolvedKey,
      ...(ns.namespace !== undefined ? { namespace: ns.namespace } : {}),
      ...(ns.namespaces !== undefined ? { namespaces: ns.namespaces } : {}),
      ...(ns.keyPrefix !== undefined ? { keyPrefix: ns.keyPrefix } : {}),
      ...(loc.locale !== undefined ? { locale: loc.locale } : {}),
      ...(loc.fallbackLocale !== undefined
        ? { fallbackLocale: loc.fallbackLocale }
        : {}),
      resolutionSource:
        ns.resolutionSource !== "unknown"
          ? ns.resolutionSource
          : loc.resolutionSource,
      resolutionChain: chain,
      confidence,
      absolutePath: input.absolutePath,
      relativePath: input.relativePath,
      location: input.location,
      ...(library !== undefined ? { library } : {}),
      evidence: evidenceParts.join("; "),
    };
  }

  getContext(): TranslationContext | undefined {
    return this.lastContext;
  }

  clearCache(): void {
    this.contextCache.clear();
    this.lastContext = undefined;
  }

  private ensureContext(): TranslationContext {
    return this.lastContext ?? this.analyze();
  }
}

function uniqueSources(
  sources: readonly ResolutionSource[],
): ResolutionSource[] {
  const seen = new Set<string>();
  const out: ResolutionSource[] = [];
  for (const s of sources) {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

function now(): number {
  return Date.now();
}

export function createContextAnalyzer(
  options: ContextAnalyzerOptions,
): ContextAnalyzer {
  return new DefaultContextAnalyzer(options);
}

export const contextAnalyzerFactory: ContextAnalyzerFactory = {
  createContextAnalyzer,
};
