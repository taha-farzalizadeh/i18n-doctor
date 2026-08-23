/**
 * Locates the language server module the extension should launch.
 *
 * Resolution order:
 *
 *   1. `i18nDoctor.languageServer.path` — explicit user override. If set but
 *      missing, resolution fails loudly instead of silently falling back,
 *      because the user asked for that specific server.
 *   2. `dist/server.js` inside the extension — the bundled server shipped in
 *      the .vsix. This is the production path; it has zero external
 *      dependencies.
 *   3. `@i18n-doctor/language-server/dist/bin.js` found by walking up from the
 *      extension root through node_modules — the development path when running
 *      the Extension Development Host from the monorepo before bundling.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export type ServerModuleKind = "explicit" | "bundled" | "workspace";

export interface ServerModule {
  /** Absolute path to the Node module implementing the server. */
  readonly module: string;
  readonly kind: ServerModuleKind;
}

export interface ResolveServerModuleOptions {
  /** The extension's installation directory (`context.extensionPath`). */
  readonly extensionRoot: string;
  /** Value of `i18nDoctor.languageServer.path`, if set. */
  readonly explicitPath?: string | undefined;
  /** Injectable for tests; defaults to `fs.existsSync`. */
  readonly fileExists?: (candidate: string) => boolean;
}

export interface ResolveServerModuleResult {
  readonly server?: ServerModule;
  /** Human-readable reason when no server could be found. */
  readonly error?: string;
}

const BUNDLED_RELATIVE = path.join("dist", "server.js");
const WORKSPACE_RELATIVE = path.join(
  "node_modules",
  "@i18n-doctor",
  "language-server",
  "dist",
  "bin.js",
);

export function resolveServerModule(
  options: ResolveServerModuleOptions,
): ResolveServerModuleResult {
  const exists = options.fileExists ?? ((p: string) => fs.existsSync(p));

  if (options.explicitPath !== undefined) {
    const resolved = path.isAbsolute(options.explicitPath)
      ? options.explicitPath
      : path.resolve(options.extensionRoot, options.explicitPath);
    if (exists(resolved)) {
      return { server: { module: resolved, kind: "explicit" } };
    }
    return {
      error:
        `i18nDoctor.languageServer.path points to "${resolved}", ` +
        "but no file exists there.",
    };
  }

  const bundled = path.join(options.extensionRoot, BUNDLED_RELATIVE);
  if (exists(bundled)) {
    return { server: { module: bundled, kind: "bundled" } };
  }

  // Development fallback: walk up from the extension root so hoisted
  // node_modules layouts (npm workspaces) are found too.
  let current = options.extensionRoot;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(current, WORKSPACE_RELATIVE);
    if (exists(candidate)) {
      return { server: { module: candidate, kind: "workspace" } };
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return {
    error:
      `The i18n-doctor language server was not found at "${bundled}". ` +
      "The extension appears to be corrupted — try reinstalling it, or run " +
      '"npm run build" in packages/vscode when developing from the monorepo.',
  };
}
