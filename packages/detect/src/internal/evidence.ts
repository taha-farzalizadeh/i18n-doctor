import type {
  Confidence,
  DetectedItem,
  DetectionEvidence,
} from "../api/types.js";

export function evidence(
  kind: DetectionEvidence["kind"],
  message: string,
  weight: number,
  path?: string,
  detail?: string,
): DetectionEvidence {
  return {
    kind,
    message,
    weight,
    ...(path !== undefined ? { path } : {}),
    ...(detail !== undefined ? { detail } : {}),
  };
}

/** Combine evidence weights with diminishing returns, clamped to [0, 1]. */
export function scoreConfidence(items: readonly DetectionEvidence[]): Confidence {
  if (items.length === 0) {
    return 0;
  }
  // 1 - Π(1 - w) gives smooth saturation
  let remaining = 1;
  for (const item of items) {
    const w = Math.min(1, Math.max(0, item.weight));
    remaining *= 1 - w;
  }
  const score = 1 - remaining;
  return Math.round(score * 1000) / 1000;
}

export function buildDetectedItem<TId extends string>(
  id: TId,
  name: string,
  evidenceList: readonly DetectionEvidence[],
  extra?: Record<string, unknown>,
): DetectedItem<TId> & Record<string, unknown> {
  return {
    id,
    name,
    confidence: scoreConfidence(evidenceList),
    evidence: evidenceList,
    ...extra,
  };
}

export function pickPrimary<T extends { confidence: number }>(
  items: readonly T[],
): T | undefined {
  if (items.length === 0) {
    return undefined;
  }
  return [...items].sort((a, b) => b.confidence - a.confidence)[0];
}

export function filterByMinConfidence<T extends { confidence: number }>(
  items: readonly T[],
  min: number,
): T[] {
  return items.filter((item) => item.confidence >= min);
}
