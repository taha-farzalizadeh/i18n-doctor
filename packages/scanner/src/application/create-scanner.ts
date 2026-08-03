import type { CreateScannerOptions } from "../config/scanner-options.js";
import {
  resolveScannerConfig,
  type ScannerConfig,
} from "../config/scanner-config.js";
import type { ChangeSet } from "../domain/change-set.js";
import type { IgnoreExplanation } from "../domain/ignore.js";
import type { DiscoverContribution, DiscoveryPlan } from "../domain/plan.js";
import type { RelativePosixPath } from "../domain/paths.js";
import type { ScanScope } from "../domain/scope.js";
import type { ProjectSnapshotView } from "../domain/snapshot.js";
import { IgnoreEngine } from "../infrastructure/ignore-engine.js";
import { NodeFileSystem } from "../infrastructure/node-fs.js";
import { WorkspaceDetector } from "../infrastructure/workspace-detector.js";
import type { FileSystemPort } from "../ports/filesystem.js";
import type { WorkspaceDetectorPort } from "../ports/workspace-detector.js";
import type { Scanner, ScannerFactory } from "./scanner.js";
import { buildDiscoveryPlan } from "./plan-builder.js";
import { createSnapshotView } from "./snapshot.js";
import { walkProject } from "./walker.js";

export interface CreateScannerInternalOptions extends CreateScannerOptions {
  readonly fs?: FileSystemPort;
  readonly workspaceDetector?: WorkspaceDetectorPort;
}

class ProjectScanner implements Scanner {
  private readonly fs: FileSystemPort;
  private readonly workspaceDetector: WorkspaceDetectorPort;
  private readonly defaultConfig: ScannerConfig;
  private readonly useGitIgnore: boolean;

  constructor(options: CreateScannerInternalOptions = {}) {
    this.fs = options.fs ?? new NodeFileSystem();
    this.workspaceDetector =
      options.workspaceDetector ?? new WorkspaceDetector(this.fs);

    const base = resolveScannerConfig(options.config);
    this.defaultConfig = buildDefaultConfig(options, base);
    this.useGitIgnore = base.useGitIgnore;
  }

  async buildPlan(
    config: ScannerConfig,
    discoverContributions: readonly DiscoverContribution[] = [],
  ): Promise<DiscoveryPlan> {
    const merged = mergeScannerConfig(this.defaultConfig, config);

    return buildDiscoveryPlan(merged, discoverContributions, {
      fs: this.fs,
      workspaceDetector: this.workspaceDetector,
      useGitIgnore: merged.useGitIgnore ?? this.useGitIgnore,
    });
  }

  async scan(
    plan: DiscoveryPlan,
    scope: ScanScope,
  ): Promise<ProjectSnapshotView> {
    const walk = await walkProject({
      fs: this.fs,
      plan,
      scope,
      useGitIgnore: this.useGitIgnore,
    });
    const snapshot = createSnapshotView(plan, walk, this.fs);

    if (plan.hash === "always") {
      for (const entry of snapshot.files()) {
        await snapshot.content.hash(entry.fileId);
      }
    }

    return snapshot;
  }

  async rescan(
    snapshot: ProjectSnapshotView,
    plan: DiscoveryPlan,
    changeSet: ChangeSet,
  ): Promise<ProjectSnapshotView> {
    if (changeSet.changes.length === 0) {
      return snapshot;
    }

    // Correctness-first incremental strategy: re-scan workspace for content changes.
    // Avoids loading file bytes; discovery metadata only.
    void changeSet;
    return this.scan(plan, { kind: "workspace" });
  }

  explainIgnored(
    plan: DiscoveryPlan,
    path: RelativePosixPath,
  ): IgnoreExplanation {
    const engine = new IgnoreEngine(plan.ignoreRules);
    return engine.explain(path);
  }
}

export function createScanner(options?: CreateScannerOptions): Scanner {
  return new ProjectScanner(options);
}

export const scannerFactory: ScannerFactory = {
  createScanner,
};

function buildDefaultConfig(
  options: CreateScannerInternalOptions,
  base: ReturnType<typeof resolveScannerConfig>,
): ScannerConfig {
  const config: ScannerConfig = { ...(options.config ?? {}) };
  setOptional(config, "fsConcurrency", options.fsConcurrency ?? base.fsConcurrency);
  setOptional(config, "maxFileBytes", options.maxFileBytes ?? base.maxFileBytes);
  if ((options.cacheDir ?? base.cacheDir) !== undefined) {
    setOptional(config, "cacheDir", options.cacheDir ?? base.cacheDir);
  }
  return config;
}

function mergeScannerConfig(
  base: ScannerConfig,
  override: ScannerConfig,
): ScannerConfig {
  const merged: ScannerConfig = { ...base };
  for (const key of Object.keys(override) as (keyof ScannerConfig)[]) {
    const value = override[key];
    if (value !== undefined) {
      setOptional(merged, key, value);
    }
  }
  return merged;
}

function setOptional<K extends keyof ScannerConfig>(
  target: ScannerConfig,
  key: K,
  value: ScannerConfig[K],
): void {
  if (value !== undefined) {
    (target as Record<K, ScannerConfig[K]>)[key] = value;
  }
}
