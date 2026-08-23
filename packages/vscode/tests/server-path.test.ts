import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveServerModule } from "../src/server.js";

const EXT = path.sep === "/" ? "/ext" : "C:\\ext";

function existsIn(...files: string[]): (candidate: string) => boolean {
  return (candidate) => files.includes(candidate);
}

describe("resolveServerModule", () => {
  it("prefers the bundled server shipped in the extension", () => {
    const bundled = path.join(EXT, "dist", "server.js");
    const result = resolveServerModule({
      extensionRoot: EXT,
      fileExists: existsIn(bundled),
    });

    expect(result.server).toEqual({ module: bundled, kind: "bundled" });
  });

  it("uses an explicit override before anything else", () => {
    const bundled = path.join(EXT, "dist", "server.js");
    const explicit = path.join(EXT, "custom", "bin.js");
    const result = resolveServerModule({
      extensionRoot: EXT,
      explicitPath: explicit,
      fileExists: existsIn(bundled, explicit),
    });

    expect(result.server).toEqual({ module: explicit, kind: "explicit" });
  });

  it("resolves a relative explicit path against the extension root", () => {
    const target = path.join(EXT, "custom", "bin.js");
    const result = resolveServerModule({
      extensionRoot: EXT,
      explicitPath: path.join("custom", "bin.js"),
      fileExists: existsIn(target),
    });

    expect(result.server?.module).toBe(target);
  });

  it("fails loudly when an explicit path is missing instead of falling back", () => {
    const bundled = path.join(EXT, "dist", "server.js");
    const result = resolveServerModule({
      extensionRoot: EXT,
      explicitPath: path.join(EXT, "gone.js"),
      fileExists: existsIn(bundled),
    });

    expect(result.server).toBeUndefined();
    expect(result.error).toContain("gone.js");
  });

  it("falls back to the workspace install, walking up hoisted node_modules", () => {
    // Monorepo layout: extension at <repo>/packages/vscode, dependency
    // hoisted to <repo>/node_modules.
    const extensionRoot = path.join(EXT, "packages", "vscode");
    const hoisted = path.join(
      EXT,
      "node_modules",
      "@i18n-doctor",
      "language-server",
      "dist",
      "bin.js",
    );
    const result = resolveServerModule({
      extensionRoot,
      fileExists: existsIn(hoisted),
    });

    expect(result.server).toEqual({ module: hoisted, kind: "workspace" });
  });

  it("reports a useful error when no server can be found", () => {
    const result = resolveServerModule({
      extensionRoot: EXT,
      fileExists: () => false,
    });

    expect(result.server).toBeUndefined();
    expect(result.error).toContain(path.join(EXT, "dist", "server.js"));
    expect(result.error).toContain("reinstalling");
  });
});
