/**
 * check command orchestration — wires existing packages only.
 * No analyzer logic is duplicated here.
 */

import fs from "node:fs";
import path from "node:path";
import {
  createEffectiveConfigResolver,
  createIgnoreEngine,
  createSuppressionEngine,
  type EffectiveConfig,
  type UserConfig,
} from "@i18n-unused/config";
import {
  createDetector,
  type ProjectDetectionResult,
} from "@i18n-unused/detect";
import {
  createIssueEngine,
  definitionsFromCatalog,
  usagesFromCatalog,
  type AnalysisResult,
  type IssueSeverity,
} from "@i18n-unused/issues";
import { createSourceDetector } from "@i18n-unused/sources";
import { createUsageDetector } from "@i18n-unused/usages";
import type {
  CheckCliOptions,
  CheckRunResult,
  CliTimings,
} from "../api/types.js";
import { countBySeverity } from "../api/types.js";
import { assertConfigReadable, discoverProject } from "./discover.js";
import { CliError } from "./errors.js";
import {
  applyIssuePolicies,
  filterDefinitionFacts,
  filterUsageFacts,
} from "./filter.js";
import {
  buildCliUserConfig,
  earlyFormatGuess,
  resolveOutputFormat,
} from "./format-options.js";
import { mergeAnalysisResults } from "./merge-results.js";
import {
  createProgressRenderer,
  shouldShowProgress,
} from "./progress.js";
import { selectReporter } from "./reporters/select.js";
import { resolveScanLimits } from "./scan-limits.js";
import { detectTerminalCapabilities } from "./supports.js";

export async function runCheck(
  options: CheckCliOptions = {},
): Promise<CheckRunResult> {
  if (options.fix) {
    throw new CliError("NOT_IMPLEMENTED", "Not implemented yet");
  }

  const wallStart = now();
  let discoverMs = 0;
  let configMs = 0;
  let detectMs = 0;
  let sourcesMs = 0;
  let usagesMs = 0;
  let analyzeMs = 0;
  let filterMs = 0;
  let reportMs = 0;

  const earlyFormat = earlyFormatGuess(options);
  const caps = detectTerminalCapabilities({
    ...(options.noColor ? { noColor: true } : {}),
  });

  const progress = createProgressRenderer({
    enabled: shouldShowProgress({
      ...(options.silent ? { silent: true } : {}),
      format: earlyFormat,
      isTTY: Boolean(process.stderr.isTTY),
    }),
    color: caps.color,
    unicode: caps.unicode,
  });

  // 1. Project discovery
  progress.step("Discovering project…");
  let t0 = now();
  const project = discoverProject({
    ...(options.path !== undefined ? { pathArg: options.path } : {}),
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
  });
  discoverMs = now() - t0;

  // 2. Configuration loading
  progress.step("Loading configuration…");
  t0 = now();
  const cliOverrides = buildCliUserConfig(options);
  const resolver = createEffectiveConfigResolver();

  let configPath: string | undefined;
  if (options.config) {
    configPath = assertConfigReadable(options.config, project.root);
  }

  const resolveBase: {
    root: string;
    cli?: UserConfig;
    configPath?: string;
  } = { root: project.root };
  if (Object.keys(cliOverrides).length > 0) {
    resolveBase.cli = cliOverrides;
  }
  if (configPath) resolveBase.configPath = configPath;

  const rootConfig = resolver.resolve(resolveBase);
  const scopes = resolveAnalysisScopes(resolver, rootConfig, resolveBase);
  configMs = now() - t0;

  const format = resolveOutputFormat(options, rootConfig.output.format);
  const verbose = Boolean(options.verbose || rootConfig.output.verbose);
  const capsWithConfig = detectTerminalCapabilities({
    ...(options.noColor ? { noColor: true } : {}),
    configColor: rootConfig.output.color,
  });

  const configErrors = rootConfig.diagnostics.filter(
    (d) => d.severity === "error",
  );
  if (configErrors.length > 0) {
    progress.fail("Configuration invalid");
    throw new CliError(
      "CONFIG",
      configErrors.map((d) => d.message).join("; "),
      configErrors[0]?.hint !== undefined
        ? { hint: configErrors[0].hint }
        : undefined,
    );
  }

  if (verbose) {
    for (const d of rootConfig.diagnostics.filter((x) => x.severity === "warning")) {
      process.stderr.write(`warning[CONFIG]: ${d.message}\n`);
    }
  }

  // 3. Auto framework detection (workspace root)
  progress.step("Detecting framework…");
  t0 = now();
  const detection = await createDetector().detect({
    root: project.root,
    maxSourceFiles: resolveScanLimits().maxSourceFiles,
  });
  detectMs = now() - t0;

  const libraryHints = resolveLibraryHints(options, detection);
  const limits = resolveScanLimits();

  // 4. Analyze each scope (single root or monorepo packages)
  const analyses: AnalysisResult[] = [];
  let sourcesAcc = 0;
  let usagesAcc = 0;
  let analyzeAcc = 0;
  let filterAcc = 0;

  for (const scope of scopes) {
    const label =
      scopes.length > 1
        ? `Analyzing ${path.relative(project.root, scope.root) || "."}…`
        : "Collecting translation sources…";
    progress.step(label);

    const part = await analyzeScope({
      scope,
      options,
      libraryHints,
      limits,
      useDetection: !options.framework,
    });
    analyses.push(part.analysis);
    sourcesAcc += part.sourcesMs;
    usagesAcc += part.usagesMs;
    analyzeAcc += part.analyzeMs;
    filterAcc += part.filterMs;
  }

  sourcesMs = sourcesAcc;
  usagesMs = usagesAcc;
  analyzeMs = analyzeAcc;
  filterMs = filterAcc;

  const analysis = mergeAnalysisResults(project.root, analyses);

  // 5. Reporter selection + output
  t0 = now();
  const timings: CliTimings = {
    totalMs: now() - wallStart,
    discoverMs,
    configMs,
    detectMs,
    sourcesMs,
    usagesMs,
    analyzeMs,
    filterMs,
    reportMs: 0,
  };

  const reporter = selectReporter(format, {
    color: capsWithConfig.color,
    hyperlinks: capsWithConfig.hyperlinks,
    verbose,
    timings,
    detection,
  });
  const report = reporter.report(analysis);
  reportMs = now() - t0;

  const finalTimings: CliTimings = {
    ...timings,
    reportMs,
    totalMs: now() - wallStart,
  };

  const finalReport =
    format === "terminal" && verbose
      ? selectReporter(format, {
          color: capsWithConfig.color,
          hyperlinks: capsWithConfig.hyperlinks,
          verbose,
          timings: finalTimings,
          detection,
        }).report(analysis)
      : report;

  progress.succeed(`Done (${Math.round(finalTimings.totalMs)}ms)`);

  const counts = countBySeverity(analysis.issues);
  const exitCode = rootConfig.exit.exitCode({
    error: counts.error,
    warning: counts.warning,
  });

  const result: CheckRunResult = {
    root: project.root,
    config: rootConfig,
    detection,
    analysis,
    format,
    report: finalReport,
    timings: finalTimings,
    exitCode,
  };
  if (options.framework) {
    return { ...result, frameworkOverride: options.framework };
  }
  return result;
}

interface ScopeAnalysis {
  readonly analysis: AnalysisResult;
  readonly sourcesMs: number;
  readonly usagesMs: number;
  readonly analyzeMs: number;
  readonly filterMs: number;
}

async function analyzeScope(input: {
  readonly scope: EffectiveConfig;
  readonly options: CheckCliOptions;
  readonly libraryHints: readonly string[] | undefined;
  readonly limits: ReturnType<typeof resolveScanLimits>;
  readonly useDetection: boolean;
}): Promise<ScopeAnalysis> {
  const root = input.scope.packageRoot ?? input.scope.root;

  // Parallel source + usage collection (largest wall-time win on big trees).
  const tSources = now();
  const tUsages = now();
  const [sourceCatalog, usageCatalog] = await Promise.all([
    createSourceDetector().discover({
      root,
      useDetection: input.useDetection,
      ...(input.libraryHints ? { libraryHints: input.libraryHints } : {}),
      minConfidence: input.scope.minConfidence,
      maxCandidates: input.limits.maxCandidates,
    }),
    createUsageDetector().detect({
      root,
      useDetection: input.useDetection,
      ...(input.libraryHints ? { libraryHints: input.libraryHints } : {}),
      minConfidence: input.scope.minConfidence,
      maxFiles: input.limits.maxFiles,
    }),
  ]);
  // Attribute wall time of the parallel section to both (sum used for totals).
  const parallelMs = Math.max(now() - tSources, now() - tUsages);
  const sourcesMs = parallelMs / 2;
  const usagesMs = parallelMs / 2;

  const ignore = createIgnoreEngine(input.scope);
  const filters = {
    ...(input.options.locale !== undefined
      ? { locale: input.options.locale }
      : {}),
    ...(input.options.namespace !== undefined
      ? { namespace: input.options.namespace }
      : {}),
  };

  const definitions = filterDefinitionFacts(
    definitionsFromCatalog(sourceCatalog),
    ignore,
    filters,
  );
  const usages = filterUsageFacts(
    usagesFromCatalog(usageCatalog),
    ignore,
    filters,
  );

  const severities = toEngineSeverities(input.scope);
  let t0 = now();
  const raw = createIssueEngine().analyze({
    root,
    definitions,
    usages,
    options: {
      minConfidence: input.scope.minConfidence,
      ...(input.options.locale !== undefined
        ? { defaultLocale: input.options.locale }
        : {}),
      ...(severities ? { severities } : {}),
    },
  });
  const analyzeMs = now() - t0;

  t0 = now();
  const analysis = applyIssuePolicies(
    raw,
    input.scope,
    createSuppressionEngine(),
  );
  const filterMs = now() - t0;

  return { analysis, sourcesMs, usagesMs, analyzeMs, filterMs };
}

/**
 * Single-root by default. When `packages` is configured (or workspace
 * packages are discovered via resolveMonorepo), analyze each package scope.
 */
function resolveAnalysisScopes(
  resolver: ReturnType<typeof createEffectiveConfigResolver>,
  rootConfig: EffectiveConfig,
  resolveBase: {
    root: string;
    cli?: UserConfig;
    configPath?: string;
  },
): readonly EffectiveConfig[] {
  const wantsMonorepo =
    (rootConfig.packages?.length ?? 0) > 0 || hasWorkspaceField(resolveBase.root);

  if (!wantsMonorepo) {
    return [rootConfig];
  }

  const all = resolver.resolveMonorepo({
    root: resolveBase.root,
    ...(resolveBase.cli !== undefined ? { cli: resolveBase.cli } : {}),
  });

  // Prefer package scopes; keep root only when it is the sole entry.
  const packages = all.filter(
    (c) => c.packageRoot !== undefined && c.packageRoot !== c.root,
  );
  if (packages.length === 0) return [rootConfig];
  return packages;
}

function hasWorkspaceField(root: string): boolean {
  try {
    const text = fs.readFileSync(path.join(root, "package.json"), "utf8");
    const pkg = JSON.parse(text) as {
      workspaces?: unknown;
      pnpm?: { workspaces?: unknown };
    };
    if (pkg.workspaces) return true;
    if (pkg.pnpm?.workspaces) return true;
  } catch {
    // ignore
  }
  // pnpm-workspace.yaml / lerna / nx — light signals
  return (
    fs.existsSync(path.join(root, "pnpm-workspace.yaml")) ||
    fs.existsSync(path.join(root, "pnpm-workspace.yml")) ||
    fs.existsSync(path.join(root, "lerna.json"))
  );
}

function now(): number {
  return performance.now();
}

function resolveLibraryHints(
  options: CheckCliOptions,
  detection: ProjectDetectionResult,
): readonly string[] | undefined {
  if (options.framework) {
    return [options.framework];
  }
  const lib = detection.primary.i18nLibrary?.id;
  return lib ? [lib] : undefined;
}

function toEngineSeverities(
  config: EffectiveConfig,
):
  | {
      unusedKey?: IssueSeverity;
      missingKey?: IssueSeverity;
      duplicateKey?: IssueSeverity;
    }
  | undefined {
  const mapOne = (
    rule: "unused-key" | "missing-key" | "duplicate-key",
  ): IssueSeverity | undefined => {
    const s = config.rules.getSeverity(rule);
    if (s === "off") return undefined;
    if (s === "info" || s === "warning" || s === "error") return s;
    return undefined;
  };

  const unusedKey = mapOne("unused-key");
  const missingKey = mapOne("missing-key");
  const duplicateKey = mapOne("duplicate-key");

  const out: {
    unusedKey?: IssueSeverity;
    missingKey?: IssueSeverity;
    duplicateKey?: IssueSeverity;
  } = {};
  if (unusedKey) out.unusedKey = unusedKey;
  if (missingKey) out.missingKey = missingKey;
  if (duplicateKey) out.duplicateKey = duplicateKey;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Write report to stdout (or nowhere for silent). */
export function writeCheckReport(
  result: CheckRunResult,
  stdout: NodeJS.WritableStream = process.stdout,
): void {
  if (result.format === "silent") return;
  if (!result.report) return;
  const text = result.report.endsWith("\n")
    ? result.report
    : `${result.report}\n`;
  stdout.write(text);
}
