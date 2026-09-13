/**
 * Standalone worker entry — runs one project analysis and prints JSON to stdout.
 * Invoked synchronously from ESLint rules via stdin payload:
 *   { cwd, filename, overlays?: Record<path, text> }
 *
 * Also accepts legacy argv form: `analysis-worker <cwd> <filename>`.
 */

import fs from "node:fs";
import path from "node:path";
import { runProjectAnalysis } from "./internal/run-project-analysis.js";

interface WorkerPayload {
  readonly cwd: string;
  readonly filename: string;
  readonly overlays?: Readonly<Record<string, string>>;
}

function readPayload(): WorkerPayload {
  // spawnSync always pipes stdin; prefer JSON payload when present.
  if (!process.stdin.isTTY) {
    const stdinText = fs.readFileSync(0, "utf8").trim();
    if (stdinText.length > 0) {
      return JSON.parse(stdinText) as WorkerPayload;
    }
  }

  const cwd = process.argv[2];
  const filename = process.argv[3];
  if (!cwd || !filename) {
    process.stderr.write(
      "usage: analysis-worker <stdin json | cwd filename>\n",
    );
    process.exit(2);
  }
  return { cwd, filename };
}

try {
  const payload = readPayload();
  const overlays = new Map<string, string>();
  for (const [filePath, text] of Object.entries(payload.overlays ?? {})) {
    const absolute = path.resolve(filePath);
    overlays.set(absolute, text);
    try {
      overlays.set(fs.realpathSync(absolute), text);
    } catch {
      // unsaved / missing on disk
    }
  }

  const snapshot = await runProjectAnalysis({
    cwd: payload.cwd,
    filename: path.resolve(payload.filename),
    ...(overlays.size > 0
      ? {
          readFile: (absolutePath: string) => {
            const resolved = path.resolve(absolutePath);
            let overlay = overlays.get(resolved);
            if (overlay === undefined) {
              try {
                overlay = overlays.get(fs.realpathSync(resolved));
              } catch {
                // ignore
              }
            }
            if (overlay !== undefined) return overlay;
            try {
              return fs.readFileSync(absolutePath, "utf8");
            } catch {
              return undefined;
            }
          },
        }
      : {}),
  });
  process.stdout.write(JSON.stringify(snapshot));
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
