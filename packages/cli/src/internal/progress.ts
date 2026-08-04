/**
 * Cross-platform progress renderer (stderr).
 * Disabled for machine formats, --silent, and non-TTY.
 * Uses ASCII glyphs when Unicode is unsupported (legacy Windows consoles).
 */

import type { ProgressRenderer } from "../api/types.js";

export interface ProgressOptions {
  readonly enabled: boolean;
  readonly color?: boolean;
  readonly unicode?: boolean;
  readonly stream?: NodeJS.WritableStream;
}

const GLYPHS = {
  unicode: { step: "·", ok: "✓", fail: "✗" },
  ascii: { step: "*", ok: "+", fail: "x" },
} as const;

export function createProgressRenderer(
  options: ProgressOptions,
): ProgressRenderer {
  const stream = options.stream ?? process.stderr;
  const enabled = options.enabled;
  const color = options.color !== false && enabled;
  const glyphs = options.unicode === false ? GLYPHS.ascii : GLYPHS.unicode;
  let current: string | undefined;

  const paint = (code: string, text: string) =>
    color ? `${code}${text}\u001b[0m` : text;

  const writeLine = (text: string) => {
    if (!enabled) return;
    stream.write(`${text}\n`);
  };

  // ASCII ellipsis when Unicode disabled ("..." not "…")
  const labelOf = (label: string) =>
    options.unicode === false ? label.replaceAll("…", "...") : label;

  return {
    start(label) {
      current = label;
      writeLine(`${paint("\u001b[36m", glyphs.step)} ${labelOf(label)}`);
    },
    step(label) {
      current = label;
      writeLine(`${paint("\u001b[36m", glyphs.step)} ${labelOf(label)}`);
    },
    succeed(label) {
      const text = labelOf(label ?? current ?? "Done");
      current = undefined;
      writeLine(`${paint("\u001b[32m", glyphs.ok)} ${text}`);
    },
    fail(label) {
      const text = labelOf(label ?? current ?? "Failed");
      current = undefined;
      writeLine(`${paint("\u001b[31m", glyphs.fail)} ${text}`);
    },
    clear() {
      current = undefined;
    },
  };
}

export function shouldShowProgress(input: {
  readonly silent?: boolean;
  readonly format: string;
  readonly isTTY?: boolean;
}): boolean {
  if (input.silent) return false;
  if (input.format !== "terminal") return false;
  return input.isTTY ?? Boolean(process.stderr.isTTY);
}
