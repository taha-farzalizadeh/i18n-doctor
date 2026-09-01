import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverProject, pathsEqual } from "@i18n-doctor/cli";
import type {
  AnalysisSessionSnapshot,
  RunProjectAnalysisOptions,
} from "./run-project-analysis.js";

export type { AnalysisSessionSnapshot, RunProjectAnalysisOptions };
export { runProjectAnalysis } from "./run-project-analysis.js";

interface SessionEntry {
  readonly snapshot: AnalysisSessionSnapshot;
}

/** Per-process cache keyed by discovered project root. */
const sessions = new Map<string, SessionEntry>();

/** Test hook — number of worker invocations in this process. */
let workerInvocations = 0;

function resolveWorkerScript(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const besideInternal = path.join(here, "..", "analysis-worker.js");
  if (fs.existsSync(besideInternal)) return besideInternal;
  const packageDist = path.join(here, "..", "..", "dist", "analysis-worker.js");
  if (fs.existsSync(packageDist)) return packageDist;
  return besideInternal;
}

const workerScript = resolveWorkerScript();

export function resetAnalysisSessions(): void {
  sessions.clear();
  workerInvocations = 0;
}

export function getAnalyzeScopeCallCount(): number {
  return workerInvocations;
}

export function getAnalysisSession(
  options: RunProjectAnalysisOptions,
): AnalysisSessionSnapshot {
  const project = discoverProject({
    cwd: options.cwd,
    pathArg: options.filename,
  });
  const key = project.root;

  const existing = sessions.get(key);
  if (existing) return existing.snapshot;

  workerInvocations += 1;
  ensureWorkerBuilt();

  const result = spawnSync(
    process.execPath,
    [workerScript, options.cwd, options.filename],
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() ||
        `i18n-doctor analysis worker exited with code ${String(result.status)}`,
    );
  }

  const snapshot = JSON.parse(result.stdout) as AnalysisSessionSnapshot;
  sessions.set(key, { snapshot });
  return snapshot;
}

export function fileMatchesIssuePath(
  filename: string,
  issuePath: string,
): boolean {
  return pathsEqual(path.resolve(filename), path.resolve(issuePath));
}

export function createReadFileOverlay(
  filename: string,
  text: string,
): (absolutePath: string) => string | undefined {
  const absolute = path.resolve(filename);
  return (target) => (pathsEqual(target, absolute) ? text : undefined);
}

export function ensureWorkerBuilt(): void {
  if (!fs.existsSync(workerScript)) {
    throw new Error(
      `Missing ${workerScript}. Run npm run build -w @i18n-doctor/eslint-plugin`,
    );
  }
}
