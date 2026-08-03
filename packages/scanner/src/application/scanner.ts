import type { ChangeSet } from "../domain/change-set.js";
import type { IgnoreExplanation } from "../domain/ignore.js";
import type { DiscoverContribution, DiscoveryPlan } from "../domain/plan.js";
import type { RelativePosixPath } from "../domain/paths.js";
import type { ScanScope } from "../domain/scope.js";
import type { ProjectSnapshotView } from "../domain/snapshot.js";
import type { ScannerConfig } from "../config/scanner-config.js";

/**
 * Public scanner port.
 */
export interface Scanner {
  /**
   * Pure merge of config + discover contributions into a frozen plan.
   * May become async when root identity resolution requires IO.
   */
  buildPlan(
    config: ScannerConfig,
    discoverContributions?: readonly DiscoverContribution[],
  ): DiscoveryPlan | Promise<DiscoveryPlan>;

  /** Full scan for the given scope against a frozen plan. */
  scan(plan: DiscoveryPlan, scope: ScanScope): Promise<ProjectSnapshotView>;

  /** Incremental scan producing a new immutable snapshot. */
  rescan(
    snapshot: ProjectSnapshotView,
    plan: DiscoveryPlan,
    changeSet: ChangeSet,
  ): Promise<ProjectSnapshotView>;

  /** Debug helper for ignore decisions; not a hot-path API. */
  explainIgnored(
    plan: DiscoveryPlan,
    path: RelativePosixPath,
  ): IgnoreExplanation | Promise<IgnoreExplanation>;
}

export interface ScannerFactory {
  createScanner(
    options?: import("../config/scanner-options.js").CreateScannerOptions,
  ): Scanner;
}
