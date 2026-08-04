import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { onTestFinished } from "vitest";
import type { DefinitionFact, UsageFact } from "../src/index.js";

export const ROOT = "/tmp/demo-project";

/** Temporary project fixture cleaned up after the current test. */
export async function fixture(
  files: Record<string, string>,
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "i18n-issues-"));
  onTestFinished(async () => {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  });
  for (const [relative, content] of Object.entries(files)) {
    const abs = path.join(root, relative);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
  return root;
}

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
