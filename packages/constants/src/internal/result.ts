import type {
  EvaluationResult,
  EvaluationStep,
  SourceLocation,
} from "../api/types.js";

export function ok(
  value: string | string[],
  sourceLocation: SourceLocation,
  chain: readonly EvaluationStep[],
  confidence: number,
): EvaluationResult {
  return {
    resolved: true,
    value,
    sourceLocation,
    resolutionChain: Object.freeze([...chain]),
    confidence: round(confidence),
    circular: false,
  };
}

export function fail(
  sourceLocation: SourceLocation,
  chain: readonly EvaluationStep[],
  options: { circular?: boolean; confidence?: number } = {},
): EvaluationResult {
  return {
    resolved: false,
    sourceLocation,
    resolutionChain: Object.freeze([...chain]),
    confidence: options.confidence ?? 0,
    circular: options.circular ?? false,
  };
}

export function round(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

export function asString(value: string | string[]): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function pushStep(
  chain: readonly EvaluationStep[],
  step: EvaluationStep,
): EvaluationStep[] {
  return [...chain, step];
}
