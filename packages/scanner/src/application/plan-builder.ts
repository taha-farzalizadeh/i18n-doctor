import { createHash } from "node:crypto";
import { DEFAULT_BUILTIN_EXCLUDE_PATTERNS } from "../config/defaults.js";
import {
  resolveScannerConfig,
  type ResolvedScannerConfig,
  type ScannerConfig,
} from "../config/scanner-config.js";
import { asRelativePosixPath } from "../domain/brands.js";
import type { IgnoreRule } from "../domain/ignore.js";
import type { DiscoverContribution, DiscoveryPlan } from "../domain/plan.js";
import type { CasePolicy, RelativePosixPath } from "../domain/paths.js";
import {
  createRootIdentity,
  detectDefaultCasePolicy,
  normalizeUserRelative,
  toOsPath,
} from "../domain/path-utils.js";
import type { FileSystemPort } from "../ports/filesystem.js";
import type { WorkspaceDetectorPort } from "../ports/workspace-detector.js";
import { parseGitignoreContent } from "../infrastructure/ignore-engine.js";
import { readTextFile } from "../infrastructure/node-fs.js";

const GITIGNORE_READ_LIMIT = 1024 * 1024;

export interface PlanBuilderDeps {
  readonly fs: FileSystemPort;
  readonly workspaceDetector: WorkspaceDetectorPort;
  readonly useGitIgnore: boolean;
}

export async function buildDiscoveryPlan(
  config: ScannerConfig,
  contributions: readonly DiscoverContribution[],
  deps: PlanBuilderDeps,
): Promise<DiscoveryPlan> {
  const resolved = resolveScannerConfig(config);
  const rootOs = await deps.fs.resolveRoot(resolved.root);
  const root = createRootIdentity(rootOs);
  const casePolicy: CasePolicy =
    resolved.casePolicy === "auto"
      ? detectDefaultCasePolicy()
      : resolved.casePolicy;

  let packageRoots: RelativePosixPath[];
  if (resolved.packages && resolved.packages.length > 0) {
    packageRoots = resolved.packages.map((p) =>
      normalizeUserRelative(rootOs, p, casePolicy),
    );
  } else {
    const detected = await deps.workspaceDetector.detect(rootOs);
    packageRoots = [...detected.packageRoots];
  }

  const include = uniqueStrings([
    ...resolved.include,
    ...contributions.flatMap((c) => c.include ?? []),
    ...contributions.flatMap((c) =>
      (c.resourceRoots ?? []).map((resourceRoot) =>
        resourceRoot === ""
          ? "**/*"
          : `${String(resourceRoot).replace(/\/$/, "")}/**/*`,
      ),
    ),
  ]);

  const extensions = uniqueStrings([
    ...resolved.extensions,
    ...contributions.flatMap((c) => c.extensions ?? []),
  ]).map((e) => e.replace(/^\./, "").toLowerCase());

  const ignoreRules = await collectIgnoreRules(resolved, contributions, rootOs, deps);

  const planWithoutDigest = {
    root,
    packageRoots: uniqueRelative(packageRoots),
    include,
    exclude: uniqueStrings([
      ...resolved.exclude,
      ...contributions.flatMap((c) => c.exclude ?? []),
    ]),
    extensions,
    ignoreRules,
    symlink: resolved.symlink,
    dotFiles: resolved.dotFiles,
    casePolicy,
    fsConcurrency: resolved.fsConcurrency,
    maxFileBytes: resolved.maxFileBytes,
    hash: resolved.hash,
    completeness: resolved.completeness,
    contributions,
  };

  return {
    ...planWithoutDigest,
    planDigest: digestPlan(planWithoutDigest),
  };
}

async function collectIgnoreRules(
  resolved: ResolvedScannerConfig,
  contributions: readonly DiscoverContribution[],
  rootOs: import("../domain/paths.js").AbsoluteOsPath,
  deps: PlanBuilderDeps,
): Promise<IgnoreRule[]> {
  const rules: IgnoreRule[] = [];

  if (resolved.ignoreDefaults) {
    for (const pattern of DEFAULT_BUILTIN_EXCLUDE_PATTERNS) {
      rules.push({ pattern, source: "builtin", negated: false });
    }
  }

  if (deps.useGitIgnore && resolved.useGitIgnore) {
    const gitignorePath = toOsPath(rootOs, asRelativePosixPath(".gitignore"));
    if (await deps.fs.exists(gitignorePath)) {
      const text = await readTextFile(
        deps.fs,
        gitignorePath,
        GITIGNORE_READ_LIMIT,
      );
      if (text !== undefined) {
        rules.push(...parseGitignoreContent(text, "gitignore"));
      }
    }
  }

  for (const pattern of resolved.exclude) {
    rules.push({ pattern, source: "config-exclude", negated: false });
  }

  for (const contribution of contributions) {
    for (const pattern of contribution.exclude ?? []) {
      rules.push({ pattern, source: "plugin", negated: false });
    }
  }

  for (const pattern of resolved.include) {
    if (pattern.startsWith("!")) {
      rules.push({
        pattern: pattern.slice(1),
        source: "config-include",
        negated: true,
      });
    }
  }

  return rules;
}

function digestPlan(plan: Omit<DiscoveryPlan, "planDigest">): string {
  const payload = {
    root: plan.root.digest,
    packageRoots: [...plan.packageRoots].sort(),
    include: [...plan.include].sort(),
    exclude: [...plan.exclude].sort(),
    extensions: [...plan.extensions].sort(),
    ignoreRules: plan.ignoreRules.map((r) => ({
      pattern: r.pattern,
      source: r.source,
      negated: r.negated,
    })),
    symlink: plan.symlink,
    dotFiles: plan.dotFiles,
    casePolicy: plan.casePolicy,
    fsConcurrency: plan.fsConcurrency,
    maxFileBytes: plan.maxFileBytes,
    hash: plan.hash,
    completeness: plan.completeness,
    contributions: plan.contributions.map((c) => ({
      pluginId: c.pluginId,
      include: c.include,
      exclude: c.exclude,
      extensions: c.extensions,
      resourceRoots: c.resourceRoots,
    })),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function uniqueRelative(
  values: readonly RelativePosixPath[],
): RelativePosixPath[] {
  return [...new Set(values)] as RelativePosixPath[];
}
