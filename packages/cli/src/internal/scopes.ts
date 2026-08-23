/**
 * Analysis scope selection (single root vs monorepo packages).
 *
 * Shared by the `check` command and the language server so both agree on
 * which package roots get analyzed.
 */

import fs from "node:fs";
import path from "node:path";
import {
  createEffectiveConfigResolver,
  type EffectiveConfig,
  type UserConfig,
} from "@i18n-doctor/config";

export interface ResolveScopesOptions {
  readonly root: string;
  readonly cli?: UserConfig;
  readonly configPath?: string;
}

/**
 * Single-root by default. When `packages` is configured (or workspace packages
 * are discovered via resolveMonorepo), analyze each package scope.
 */
export function resolveAnalysisScopes(
  resolver: ReturnType<typeof createEffectiveConfigResolver>,
  rootConfig: EffectiveConfig,
  options: ResolveScopesOptions,
): readonly EffectiveConfig[] {
  const wantsMonorepo =
    (rootConfig.packages?.length ?? 0) > 0 || hasWorkspaceField(options.root);

  if (!wantsMonorepo) {
    return [rootConfig];
  }

  const all = resolver.resolveMonorepo({
    root: options.root,
    ...(options.cli !== undefined ? { cli: options.cli } : {}),
  });

  // Prefer package scopes; keep root only when it is the sole entry.
  const packages = all.filter(
    (c) => c.packageRoot !== undefined && c.packageRoot !== c.root,
  );
  if (packages.length === 0) return [rootConfig];
  return packages;
}

export function hasWorkspaceField(root: string): boolean {
  try {
    const text = fs.readFileSync(path.join(root, "package.json"), "utf8");
    const pkg = JSON.parse(text) as {
      workspaces?: unknown;
      pnpm?: { workspaces?: unknown };
    };
    if (pkg.workspaces) return true;
    if (pkg.pnpm?.workspaces) return true;
  } catch {
    // ignore
  }
  // pnpm-workspace.yaml / lerna / nx — light signals
  return (
    fs.existsSync(path.join(root, "pnpm-workspace.yaml")) ||
    fs.existsSync(path.join(root, "pnpm-workspace.yml")) ||
    fs.existsSync(path.join(root, "lerna.json"))
  );
}
