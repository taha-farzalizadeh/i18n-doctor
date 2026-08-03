import type { AbsoluteOsPath, RelativePosixPath } from "../domain/paths.js";
import { asRelativePosixPath } from "../domain/brands.js";
import { joinPosix, normalizeOsPath, toOsPath } from "../domain/path-utils.js";
import type {
  DetectedWorkspace,
  WorkspaceDetectorPort,
} from "../ports/workspace-detector.js";
import type { WorkspaceManager } from "../domain/workspace.js";
import type { FileSystemPort } from "../ports/filesystem.js";
import { compileGlob } from "./glob.js";
import { readTextFile } from "./node-fs.js";

const MANIFEST_READ_LIMIT = 1024 * 1024;

/**
 * Deterministic workspace detection precedence:
 * pnpm-workspace.yaml → package.json workspaces → lerna.json → nx.json → turbo.json → singleton
 */
export class WorkspaceDetector implements WorkspaceDetectorPort {
  constructor(private readonly fs: FileSystemPort) {}

  async detect(root: AbsoluteOsPath): Promise<DetectedWorkspace> {
    const found: Array<{ manager: WorkspaceManager; roots: RelativePosixPath[] }> =
      [];

    const pnpm = await this.readPnpmWorkspace(root);
    if (pnpm) {
      found.push({ manager: "pnpm", roots: pnpm });
    }

    const npmWorkspaces = await this.readPackageJsonWorkspaces(root);
    if (npmWorkspaces) {
      found.push({ manager: "npm", roots: npmWorkspaces });
    }

    const lerna = await this.readLerna(root);
    if (lerna) {
      found.push({ manager: "lerna", roots: lerna });
    }

    const nx = await this.readNx(root);
    if (nx) {
      found.push({ manager: "nx", roots: nx });
    }

    const turbo = await this.readTurbo(root);
    if (turbo) {
      found.push({ manager: "turbo", roots: turbo });
    }

    if (found.length === 0) {
      return {
        packageRoots: [asRelativePosixPath("")],
        manager: "unknown",
      };
    }

    const chosen = found[0]!;
    const packageRoots =
      chosen.roots.length > 0
        ? uniquePaths(chosen.roots)
        : [asRelativePosixPath("")];

    if (found.length === 1) {
      return { packageRoots, manager: chosen.manager };
    }

    return {
      packageRoots,
      manager: chosen.manager,
      ambiguity: {
        chosen: chosen.manager,
        discarded: found.slice(1).map((f) => f.manager),
      },
    };
  }

  private async readPnpmWorkspace(
    root: AbsoluteOsPath,
  ): Promise<RelativePosixPath[] | undefined> {
    const file = toOsPath(root, asRelativePosixPath("pnpm-workspace.yaml"));
    if (!(await this.fs.exists(file))) {
      return undefined;
    }
    const text = await readTextFile(this.fs, file, MANIFEST_READ_LIMIT);
    if (text === undefined) {
      return undefined;
    }
    const patterns = parsePnpmWorkspacePackages(text);
    if (patterns.length === 0) {
      return undefined;
    }
    return this.expandPackageGlobs(root, patterns);
  }

  private async readPackageJsonWorkspaces(
    root: AbsoluteOsPath,
  ): Promise<RelativePosixPath[] | undefined> {
    const file = toOsPath(root, asRelativePosixPath("package.json"));
    if (!(await this.fs.exists(file))) {
      return undefined;
    }
    const text = await readTextFile(this.fs, file, MANIFEST_READ_LIMIT);
    if (text === undefined) {
      return undefined;
    }
    try {
      const json = JSON.parse(text) as {
        workspaces?: string[] | { packages?: string[] };
      };
      const patterns = Array.isArray(json.workspaces)
        ? json.workspaces
        : json.workspaces?.packages;
      if (!patterns || patterns.length === 0) {
        return undefined;
      }
      return this.expandPackageGlobs(root, patterns);
    } catch {
      return undefined;
    }
  }

  private async readLerna(
    root: AbsoluteOsPath,
  ): Promise<RelativePosixPath[] | undefined> {
    const file = toOsPath(root, asRelativePosixPath("lerna.json"));
    if (!(await this.fs.exists(file))) {
      return undefined;
    }
    const text = await readTextFile(this.fs, file, MANIFEST_READ_LIMIT);
    if (text === undefined) {
      return undefined;
    }
    try {
      const json = JSON.parse(text) as { packages?: string[] };
      if (!json.packages || json.packages.length === 0) {
        return undefined;
      }
      return this.expandPackageGlobs(root, json.packages);
    } catch {
      return undefined;
    }
  }

  private async readNx(
    root: AbsoluteOsPath,
  ): Promise<RelativePosixPath[] | undefined> {
    const file = toOsPath(root, asRelativePosixPath("nx.json"));
    if (!(await this.fs.exists(file))) {
      return undefined;
    }
    const candidates = ["apps", "packages", "libs"];
    const roots: RelativePosixPath[] = [];
    for (const dir of candidates) {
      const abs = toOsPath(root, asRelativePosixPath(dir));
      if (await this.fs.exists(abs)) {
        const expanded = await this.expandPackageGlobs(root, [`${dir}/*`]);
        roots.push(...expanded);
      }
    }
    return roots.length > 0 ? roots : [asRelativePosixPath("")];
  }

  private async readTurbo(
    root: AbsoluteOsPath,
  ): Promise<RelativePosixPath[] | undefined> {
    const file = toOsPath(root, asRelativePosixPath("turbo.json"));
    if (!(await this.fs.exists(file))) {
      return undefined;
    }
    return this.readPackageJsonWorkspaces(root);
  }

  private async expandPackageGlobs(
    root: AbsoluteOsPath,
    patterns: readonly string[],
  ): Promise<RelativePosixPath[]> {
    const results: RelativePosixPath[] = [];
    for (const pattern of patterns) {
      const normalized = pattern.replace(/\\/g, "/").replace(/\/$/, "");
      if (!normalized.includes("*") && !normalized.includes("?")) {
        const abs = toOsPath(root, asRelativePosixPath(normalized));
        if (await this.fs.exists(abs)) {
          results.push(asRelativePosixPath(normalized));
        }
        continue;
      }
      const expanded = await expandGlobDirs(this.fs, root, normalized);
      results.push(...expanded);
    }
    return uniquePaths(results);
  }
}

function parsePnpmWorkspacePackages(yaml: string): string[] {
  const lines = yaml.split(/\r?\n/);
  const packages: string[] = [];
  let inPackages = false;
  for (const line of lines) {
    if (/^\s*packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      if (/^\S/.test(line) && !line.trim().startsWith("#")) {
        break;
      }
      const match = line.match(/^\s*-\s+['"]?([^'"#]+?)['"]?\s*(?:#.*)?$/);
      if (match?.[1]) {
        packages.push(match[1].trim());
      }
    }
  }
  return packages;
}

async function expandGlobDirs(
  fs: FileSystemPort,
  root: AbsoluteOsPath,
  pattern: string,
): Promise<RelativePosixPath[]> {
  const compiled = compileGlob(pattern);
  const starIndex = pattern.split("/").findIndex((p) => p.includes("*"));
  const base =
    starIndex <= 0
      ? ""
      : pattern.split("/").slice(0, starIndex).join("/");
  const baseRel = asRelativePosixPath(base);
  const baseAbs =
    baseRel === "" ? normalizeOsPath(root) : toOsPath(root, baseRel);

  if (!(await fs.exists(baseAbs))) {
    return [];
  }

  const out: RelativePosixPath[] = [];
  const stack: RelativePosixPath[] = [baseRel];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const abs = current === "" ? baseAbs : toOsPath(root, current);
    let entries;
    try {
      entries = await fs.readDir(abs);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name === "." || entry.name === "..") {
        continue;
      }
      const child = joinPosix(current, entry.name);
      const isDir = entry.kind === "directory" || entry.kind === "symlink";
      if (compiled.test(child, true) && isDir) {
        out.push(child);
      }
      // Descend one level for patterns like packages/*
      if (
        isDir &&
        pattern.includes("**") &&
        child.split("/").length < pattern.split("/").length + 4
      ) {
        stack.push(child);
      }
    }
  }

  // For `packages/*` style: only immediate children of base
  if (!pattern.includes("**")) {
    return uniquePaths(
      out.filter((p) => {
        const rel =
          baseRel === "" ? p : p.startsWith(`${baseRel}/`) ? p.slice(baseRel.length + 1) : p;
        return !rel.includes("/");
      }),
    );
  }

  return uniquePaths(out);
}

function uniquePaths(paths: readonly RelativePosixPath[]): RelativePosixPath[] {
  const seen = new Set<string>();
  const out: RelativePosixPath[] = [];
  for (const p of paths) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}
