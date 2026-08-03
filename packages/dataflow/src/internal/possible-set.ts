import type {
  AnalysisType,
  Confidence,
  DynamicKeyAnalysis,
  PossibleValueSet,
  ResolutionStep,
  SourceLocation,
} from "../api/types.js";

export function emptySet(incomplete = true): PossibleValueSet {
  return {
    values: Object.freeze([]),
    incomplete,
    confidence: 0,
    circular: false,
  };
}

export function singleton(
  value: string,
  confidence = 1,
): PossibleValueSet {
  return {
    values: Object.freeze([value]),
    incomplete: false,
    confidence: round(confidence),
    circular: false,
  };
}

export function fromValues(
  values: Iterable<string>,
  options: {
    incomplete?: boolean;
    confidence?: number;
    circular?: boolean;
    maxValues?: number;
  } = {},
): PossibleValueSet {
  const max = options.maxValues ?? 64;
  const uniq = [...new Set(values)].filter((v) => v.length > 0).sort();
  const overflow = uniq.length > max;
  const incomplete = (options.incomplete ?? false) || overflow;
  const clipped = uniq.slice(0, max);
  let confidence = options.confidence ?? (clipped.length ? 0.7 : 0);
  if (overflow) {
    confidence = Math.min(confidence, 0.45);
  }
  if (incomplete && clipped.length > 1) {
    confidence = Math.min(confidence, 0.65);
  }
  return {
    values: Object.freeze(clipped),
    incomplete,
    confidence: round(confidence),
    circular: options.circular ?? false,
  };
}

export function unionSets(
  sets: readonly PossibleValueSet[],
  maxValues: number,
): PossibleValueSet {
  if (sets.length === 0) return emptySet(true);
  const values: string[] = [];
  let incomplete = false;
  let circular = false;
  let confidence = 1;
  for (const s of sets) {
    values.push(...s.values);
    incomplete = incomplete || s.incomplete;
    circular = circular || s.circular;
    confidence = Math.min(confidence, s.confidence);
  }
  return fromValues(values, {
    incomplete,
    confidence: Math.min(confidence, sets.length > 1 ? 0.7 : confidence),
    circular,
    maxValues,
  });
}

/**
 * Cartesian concat with hard cap — never materializes more than `maxValues`
 * results. Oversized products are marked incomplete with lowered confidence.
 */
export function concatSets(
  left: PossibleValueSet,
  right: PossibleValueSet,
  maxValues: number,
): PossibleValueSet {
  if (left.values.length === 0 || right.values.length === 0) {
    return emptySet(
      left.incomplete || right.incomplete || left.values.length === 0 || right.values.length === 0,
    );
  }

  const product = left.values.length * right.values.length;
  const out: string[] = [];
  let truncated = false;

  outer: for (const l of left.values) {
    for (const r of right.values) {
      out.push(l + r);
      if (out.length >= maxValues) {
        truncated = product > maxValues;
        break outer;
      }
    }
  }

  const incomplete =
    left.incomplete || right.incomplete || truncated || product > maxValues;

  let confidence = Math.min(left.confidence, right.confidence, 0.95);
  if (incomplete) {
    confidence = Math.min(confidence, truncated ? 0.5 : 0.75);
  }
  // Multi-value × multi-value is less certain than pure static concat
  if (left.values.length > 1 || right.values.length > 1) {
    confidence = Math.min(confidence, 0.8);
  }

  return fromValues(out, {
    incomplete,
    confidence,
    circular: left.circular || right.circular,
    maxValues,
  });
}

export function toAnalysis(
  set: PossibleValueSet,
  sourceLocations: readonly SourceLocation[],
  chain: readonly ResolutionStep[],
  analysisType: AnalysisType,
): DynamicKeyAnalysis {
  const resolved = set.values.length > 0;
  return {
    resolved,
    possibleKeys: set.values,
    confidence: resolved ? set.confidence : 0,
    sourceLocations: Object.freeze([...sourceLocations]),
    resolutionChain: Object.freeze([...chain]),
    analysisType: resolved ? analysisType : "unresolved",
    circular: set.circular,
    incomplete: set.incomplete,
  };
}

export function pushStep(
  chain: readonly ResolutionStep[],
  step: ResolutionStep,
): ResolutionStep[] {
  return [...chain, step];
}

export function round(value: number): Confidence {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}
