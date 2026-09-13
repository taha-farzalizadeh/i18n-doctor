import { createHash } from "node:crypto";
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
  /** Fingerprint of config / catalog / buffer inputs so edits invalidate. */
  readonly fingerprint: string;
}

/** Per-process cache keyed by discovered project root. */
const sessions = new Map<string, SessionEntry>();

/** Test hook — number of worker invocations in this process. */
let workerInvocations = 0;

const CONFIG_CANDIDATES = [
  "i18n-doctor.config.ts",
  "i18n-doctor.config.js",
  "i18n-doctor.config.mjs",
  "i18n-doctor.config.cjs",
  "i18n-doctor.config.json",
  "package.json",
] as const;
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
  const absoluteFile = path.resolve(options.filename);
  const overlayText = options.readFile?.(absoluteFile);
  const existing = sessions.get(key);
  const fingerprint = projectFingerprint({
    root: project.root,
    filename: absoluteFile,
    overlayText,
    catalogPaths: existing?.snapshot.catalogPaths,
  });

  if (existing && existing.fingerprint === fingerprint) {
    return existing.snapshot;
  }

  workerInvocations += 1;
  ensureWorkerBuilt();

  const overlays: Record<string, string> = {};
  if (overlayText !== undefined) {
    overlays[absoluteFile] = overlayText;
  }

  const result = spawnSync(process.execPath, [workerScript], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    input: JSON.stringify({
      cwd: options.cwd,
      filename: absoluteFile,
      overlays,
    }),
  });

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
  const nextFingerprint = projectFingerprint({
    root: project.root,
    filename: absoluteFile,
    overlayText,
    catalogPaths: snapshot.catalogPaths,
  });
  sessions.set(key, { snapshot, fingerprint: nextFingerprint });
  return snapshot;
}

/**
 * Invalidation signal for the ESLint process-lifetime cache.
 * Config edits, catalog file mtime/size, and unsaved locale buffer contents
 * all force a fresh analysis so unused-key ranges stay correct.
 */
function projectFingerprint(input: {
  readonly root: string;
  readonly filename: string;
  readonly overlayText?: string | undefined;
  readonly catalogPaths?: readonly string[] | undefined;
}): string {
  const parts: string[] = [];
  for (const name of CONFIG_CANDIDATES) {
    const absolute = path.join(input.root, name);
    parts.push(fileFingerprint(name, absolute));
  }

  const catalogPaths = (input.catalogPaths ?? []).map((p) => path.resolve(p));
  for (const absolute of [...catalogPaths].sort()) {
    const relative = path.relative(input.root, absolute) || absolute;
    parts.push(fileFingerprint(relative, absolute));
  }

  const absoluteFile = path.resolve(input.filename);
  const ext = path.extname(absoluteFile).toLowerCase();
  const isLocaleResource =
    ext === ".json" || ext === ".yaml" || ext === ".yml";
  const isKnownCatalog = catalogPaths.some((p) => pathsEqual(p, absoluteFile));

  // Unsaved locale/catalog edits must invalidate. Matching-disk overlays must
  // not — otherwise linting a .json mid-run busts the shared project cache.
  if (
    input.overlayText !== undefined &&
    (isLocaleResource || isKnownCatalog) &&
    overlayDiffersFromDisk(absoluteFile, input.overlayText)
  ) {
    parts.push(`overlay:${hashText(input.overlayText)}`);
  }

  return parts.join("|");
}

function fileFingerprint(label: string, absolute: string): string {
  try {
    const stat = fs.statSync(absolute);
    return `${label}:${stat.mtimeMs}:${stat.size}`;
  } catch {
    return `${label}:missing`;
  }
}

function overlayDiffersFromDisk(absolute: string, overlayText: string): boolean {
  try {
    return fs.readFileSync(absolute, "utf8") !== overlayText;
  } catch {
    return true;
  }
}

function hashText(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 16);
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
