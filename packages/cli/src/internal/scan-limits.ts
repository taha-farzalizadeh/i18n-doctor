/**
 * Large-project scan limits — overridable via env for CI / huge monorepos.
 * Analyzer packages enforce these; CLI only selects values.
 */

export interface ScanLimits {
  readonly maxCandidates: number;
  readonly maxFiles: number;
  readonly maxSourceFiles: number;
}

const DEFAULTS: ScanLimits = {
  maxCandidates: 2_000,
  maxFiles: 8_000,
  maxSourceFiles: 800,
};

export function resolveScanLimits(
  env: NodeJS.ProcessEnv = process.env,
): ScanLimits {
  return {
    maxCandidates: readInt(env["I18N_UNUSED_MAX_CANDIDATES"], DEFAULTS.maxCandidates),
    maxFiles: readInt(env["I18N_UNUSED_MAX_FILES"], DEFAULTS.maxFiles),
    maxSourceFiles: readInt(
      env["I18N_UNUSED_MAX_SOURCE_FILES"],
      DEFAULTS.maxSourceFiles,
    ),
  };
}

function readInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}
