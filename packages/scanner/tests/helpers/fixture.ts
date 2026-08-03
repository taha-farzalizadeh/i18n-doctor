import { mkdir, writeFile, symlink, chmod, rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createScanner, type ProjectSnapshotView, type ScannerConfig } from "../../src/index.js";

export interface TreeFile {
  readonly path: string;
  readonly content?: string | Buffer;
}

export async function createTempRoot(prefix = "i18n-scanner-"): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

export async function writeTree(root: string, files: readonly TreeFile[]): Promise<void> {
  for (const file of files) {
    const abs = path.join(root, ...file.path.split("/"));
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, file.content ?? "");
  }
}

export async function ensureDir(root: string, relative: string): Promise<string> {
  const abs = path.join(root, ...relative.split("/"));
  await mkdir(abs, { recursive: true });
  return abs;
}

export async function makeSymlink(
  target: string,
  linkPath: string,
  type: "file" | "dir" = "file",
): Promise<void> {
  await mkdir(path.dirname(linkPath), { recursive: true });
  await symlink(target, linkPath, type === "dir" ? "dir" : "file");
}

export async function withFixture<T>(
  setup: (root: string) => Promise<void>,
  run: (root: string) => Promise<T>,
): Promise<T> {
  const root = await createTempRoot();
  try {
    await setup(root);
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  }
}

export async function scanRoot(
  root: string,
  config: ScannerConfig = {},
): Promise<ProjectSnapshotView> {
  const scanner = createScanner({
    config: {
      root,
      ignoreDefaults: true,
      useGitIgnore: true,
      ...config,
    },
  });
  const plan = await scanner.buildPlan({
    root,
    ignoreDefaults: true,
    useGitIgnore: true,
    ...config,
  });
  return scanner.scan(plan, { kind: "workspace" });
}

export function relativePaths(snapshot: ProjectSnapshotView): string[] {
  return [...snapshot.files()].map((f) => f.relativePath).sort();
}

export function hasPath(snapshot: ProjectSnapshotView, relative: string): boolean {
  return relativePaths(snapshot).includes(relative);
}

export async function tryChmodDenied(absPath: string): Promise<boolean> {
  if (process.platform === "win32") {
    return false;
  }
  try {
    await chmod(absPath, 0);
    return true;
  } catch {
    return false;
  }
}

export async function restoreChmod(absPath: string): Promise<void> {
  if (process.platform === "win32") {
    return;
  }
  await chmod(absPath, 0o755).catch(() => undefined);
}

export function isPosix(): boolean {
  return process.platform !== "win32";
}
