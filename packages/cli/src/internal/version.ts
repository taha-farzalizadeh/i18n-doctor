import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

export function getPackageVersion(): string {
  try {
    // dist/internal/version.js → up two levels → package root
    const pkg = require("../../package.json") as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function getPackageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}
