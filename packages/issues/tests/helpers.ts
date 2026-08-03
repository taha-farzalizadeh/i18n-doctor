import path from "node:path";
import type { DefinitionFact, UsageFact } from "../src/index.js";

export const ROOT = "/tmp/demo-project";

export function def(
  key: string,
  file: string,
  line: number,
  extra: Partial<DefinitionFact> = {},
): DefinitionFact {
  return {
    key,
    absolutePath: path.join(ROOT, file),
    relativePath: file,
    line,
    column: 1,
    ...extra,
  };
}

export function use(
  key: string,
  file: string,
  line: number,
  extra: Partial<UsageFact> = {},
): UsageFact {
  return {
    key,
    absolutePath: path.join(ROOT, file),
    relativePath: file,
    line,
    column: 8,
    ...extra,
  };
}

/** Strip timings for byte-stable JSON comparisons across runs. */
export function stripTimings(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const clone = structuredClone(payload) as {
    timings?: { totalMs: number; analyzeMs: number };
  };
  if (clone.timings) {
    clone.timings.totalMs = 0;
    clone.timings.analyzeMs = 0;
  }
  return clone;
}
