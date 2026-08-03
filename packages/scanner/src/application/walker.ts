import { asFileId, asPackageId, asRelativePosixPath } from "../domain/brands.js";
import type { CoverageReport } from "../domain/coverage.js";
import type { ScannerErrorRecord } from "../domain/errors.js";
import type { FileFlag } from "../domain/file-kinds.js";
import type { FileId, PackageId } from "../domain/ids.js";
import type {
  HardLinkGroup,
  HeavyFileMetadata,
  LiteFileEntry,
  PathConflict,
} from "../domain/metadata.js";
import type { DiscoveryPlan } from "../domain/plan.js";
import type { AbsoluteOsPath, RelativePosixPath } from "../domain/paths.js";
import type { ScanScope } from "../domain/scope.js";
import type { PackageUnit, ProjectSignal } from "../domain/workspace.js";
import {
  basenamePosix,
  comparePathKey,
  isWithinRoot,
  joinPosix,
  toOsPath,
  toRelativePosix,
} from "../domain/path-utils.js";
import type { FileSystemPort } from "../ports/filesystem.js";
import {
  IgnoreEngine,
  parseGitignoreContent,
} from "../infrastructure/ignore-engine.js";
import { compileGlob, matchesAnyGlob, type CompiledGlob } from "../infrastructure/glob.js";
import { readTextFile } from "../infrastructure/node-fs.js";
import { AsyncQueue } from "./concurrency.js";
import { classifyExtension, classifyRole, isHiddenName } from "./classify.js";
import { errorMessage, isErrno } from "./errors.js";

const GITIGNORE_READ_LIMIT = 1024 * 1024;

export interface WalkResult {
  readonly filesById: Map<FileId, LiteFileEntry>;
  readonly heavyById: Map<FileId, HeavyFileMetadata>;
  readonly pathIndex: Map<string, FileId>;
  readonly packages: PackageUnit[];
  readonly errors: ScannerErrorRecord[];
  readonly conflicts: PathConflict[];
  readonly hardLinkGroups: HardLinkGroup[];
  readonly signals: ProjectSignal[];
  readonly coverage: CoverageReport;
  readonly absoluteById: Map<FileId, AbsoluteOsPath>;
}

export interface WalkerOptions {
  readonly fs: FileSystemPort;
  readonly plan: DiscoveryPlan;
  readonly scope: ScanScope;
  readonly useGitIgnore: boolean;
}

export async function walkProject(options: WalkerOptions): Promise<WalkResult> {
  const { fs, plan, scope, useGitIgnore } = options;
  const rootOs = plan.root.osPath;
  const ignore = new IgnoreEngine(plan.ignoreRules);
  const includeGlobs = plan.include
    .filter((p) => !p.startsWith("!"))
    .map(compileGlob);
  const extensionSet = new Set(
    plan.extensions.map((e) => e.replace(/^\./, "").toLowerCase()),
  );

  const filesById = new Map<FileId, LiteFileEntry>();
  const heavyById = new Map<FileId, HeavyFileMetadata>();
  const pathIndex = new Map<string, FileId>();
  const absoluteById = new Map<FileId, AbsoluteOsPath>();
  const errors: ScannerErrorRecord[] = [];
  const conflicts: PathConflict[] = [];
  const inodeToFileId = new Map<string, FileId>();
  const inodePaths = new Map<string, RelativePosixPath[]>();
  const caseIndex = new Map<string, RelativePosixPath>();
  const queue = new AsyncQueue(plan.fsConcurrency);
  const visitedInodes = new Set<string>();
  const unreadableRoots: RelativePosixPath[] = [];
  let symlinkEscapesBlocked = 0;

  const packageDefs = await resolvePackages(fs, plan, scope, errors);
  const packagesScanned: PackageId[] = [];
  const packagesSkipped: PackageId[] = [];

  const ctx: WalkContext = {
    fs,
    plan,
    ignore,
    includeGlobs,
    extensionSet,
    useGitIgnore,
    queue,
    rootOs,
    filesById,
    heavyById,
    pathIndex,
    absoluteById,
    errors,
    conflicts,
    inodeToFileId,
    inodePaths,
    caseIndex,
    visitedInodes,
    unreadableRoots,
    onSymlinkEscape: () => {
      symlinkEscapesBlocked += 1;
    },
  };

  for (const pkg of packageDefs) {
    packagesScanned.push(pkg.packageId);
    const startAbs = toOsPath(rootOs, pkg.root);
    try {
      await fs.stat(startAbs);
    } catch (error) {
      recordFsError(errors, unreadableRoots, pkg.root, error);
      packagesSkipped.push(pkg.packageId);
      continue;
    }

    await walkDirectory(ctx, pkg.root, pkg.packageId);
  }

  const hardLinkGroups = buildHardLinkGroups(inodePaths, inodeToFileId);
  const packages = packageDefs.map((pkg) => ({
    ...pkg,
    fileIds: [...filesById.values()]
      .filter((f) => f.packageId === pkg.packageId)
      .map((f) => f.fileId),
  }));

  const hasPermissionErrors = errors.some((e) => e.class === "PermissionDenied");

  const coverage: CoverageReport = {
    // strict: any unreadable in-scope subtree is incomplete
    // best-effort: still return results; complete stays true for runner soft mode
    complete:
      plan.completeness === "strict"
        ? !hasPermissionErrors && unreadableRoots.length === 0
        : true,
    packagesScanned,
    packagesSkipped,
    filesCandidateCount: filesById.size,
    errorsByClass: countErrors(errors),
    unreadableRoots: [...unreadableRoots],
    zeroCandidates: filesById.size === 0,
    symlinkEscapesBlocked,
  };

  return {
    filesById,
    heavyById,
    pathIndex,
    packages,
    errors,
    conflicts,
    hardLinkGroups,
    signals: [],
    coverage,
    absoluteById,
  };
}

interface WalkContext {
  fs: FileSystemPort;
  plan: DiscoveryPlan;
  ignore: IgnoreEngine;
  includeGlobs: CompiledGlob[];
  extensionSet: Set<string>;
  useGitIgnore: boolean;
  queue: AsyncQueue;
  rootOs: AbsoluteOsPath;
  filesById: Map<FileId, LiteFileEntry>;
  heavyById: Map<FileId, HeavyFileMetadata>;
  pathIndex: Map<string, FileId>;
  absoluteById: Map<FileId, AbsoluteOsPath>;
  errors: ScannerErrorRecord[];
  conflicts: PathConflict[];
  inodeToFileId: Map<string, FileId>;
  inodePaths: Map<string, RelativePosixPath[]>;
  caseIndex: Map<string, RelativePosixPath>;
  visitedInodes: Set<string>;
  unreadableRoots: RelativePosixPath[];
  onSymlinkEscape: () => void;
}

async function walkDirectory(
  ctx: WalkContext,
  dirRel: RelativePosixPath,
  packageId: PackageId,
): Promise<void> {
  if (dirRel !== "" && ctx.ignore.isIgnored(dirRel, true)) {
    return;
  }

  if (shouldPruneHiddenDir(ctx.plan.dotFiles, dirRel)) {
    return;
  }

  if (dirRel !== "" && !matchesAnyGlob(dirRel, true, ctx.includeGlobs)) {
    return;
  }

  const dirAbs = toOsPath(ctx.rootOs, dirRel);
  let pushed = false;

  if (ctx.useGitIgnore && dirRel !== "") {
    const giRel = joinPosix(dirRel, ".gitignore");
    const giAbs = toOsPath(ctx.rootOs, giRel);
    if (await ctx.fs.exists(giAbs)) {
      const text = await readTextFile(ctx.fs, giAbs, GITIGNORE_READ_LIMIT);
      if (text !== undefined) {
        ctx.ignore.pushLayer(parseGitignoreContent(text, "gitignore"), dirRel);
        pushed = true;
      }
    }
  }

  let entries;
  try {
    entries = await ctx.queue.add(() => ctx.fs.readDir(dirAbs));
  } catch (error) {
    recordFsError(ctx.errors, ctx.unreadableRoots, dirRel, error);
    if (pushed) {
      ctx.ignore.popLayer();
    }
    return;
  }

  const childDirs: RelativePosixPath[] = [];

  for (const entry of entries) {
    if (entry.name === "." || entry.name === "..") {
      continue;
    }

    const childRel =
      dirRel === ""
        ? asRelativePosixPath(entry.name)
        : joinPosix(dirRel, entry.name);

    try {
      await processChild(ctx, packageId, childRel, childDirs);
    } catch (error) {
      recordFsError(ctx.errors, ctx.unreadableRoots, childRel, error);
    }
  }

  for (const child of childDirs) {
    await walkDirectory(ctx, child, packageId);
  }

  if (pushed) {
    ctx.ignore.popLayer();
  }
}

async function processChild(
  ctx: WalkContext,
  packageId: PackageId,
  childRel: RelativePosixPath,
  childDirs: RelativePosixPath[],
): Promise<void> {
  const childAbs = toOsPath(ctx.rootOs, childRel);

  let st;
  try {
    st = await ctx.queue.add(() => ctx.fs.stat(childAbs));
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      ctx.errors.push({
        class: "NotFound",
        message: `Path disappeared during scan: ${childRel}`,
        path: childRel,
      });
      return;
    }
    recordFsError(ctx.errors, ctx.unreadableRoots, childRel, error);
    return;
  }

  if (st.kind === "symlink") {
    await processSymlink(ctx, packageId, childRel, childAbs, childDirs);
    return;
  }

  if (st.kind === "directory") {
    if (shouldPruneHiddenDir(ctx.plan.dotFiles, childRel)) {
      return;
    }
    if (isRevisitedInode(ctx, st.device, st.inode, childRel)) {
      return;
    }
    if (ctx.ignore.isIgnored(childRel, true)) {
      return;
    }
    if (!matchesAnyGlob(childRel, true, ctx.includeGlobs)) {
      return;
    }
    childDirs.push(childRel);
    return;
  }

  if (st.kind !== "file") {
    return;
  }

  if (
    ctx.plan.dotFiles === "prune-dot-dirs" &&
    isHiddenName(basenamePosix(childRel))
  ) {
    // Hidden files are kept only when an ignore negation re-includes them;
    // still discover them if not ignored.
  }

  await addFile(ctx, packageId, childRel, childAbs, st, childAbs, false);
}

async function processSymlink(
  ctx: WalkContext,
  packageId: PackageId,
  childRel: RelativePosixPath,
  childAbs: AbsoluteOsPath,
  childDirs: RelativePosixPath[],
): Promise<void> {
  if (ctx.plan.symlink === "never") {
    return;
  }

  let real: AbsoluteOsPath;
  try {
    real = await ctx.queue.add(() => ctx.fs.realpath(childAbs));
  } catch (error) {
    recordFsError(ctx.errors, ctx.unreadableRoots, childRel, error);
    return;
  }

  if (!isWithinRoot(ctx.rootOs, real, ctx.plan.casePolicy)) {
    ctx.onSymlinkEscape();
    ctx.errors.push({
      class: "SymlinkEscape",
      message: `Symlink escapes workspace root: ${childRel}`,
      path: childRel,
    });
    return;
  }

  let targetStat;
  try {
    targetStat = await ctx.queue.add(() => ctx.fs.stat(real));
  } catch (error) {
    recordFsError(ctx.errors, ctx.unreadableRoots, childRel, error);
    return;
  }

  const targetInodeKey =
    targetStat.device && targetStat.inode
      ? `${targetStat.device}:${targetStat.inode}`
      : undefined;

  if (targetStat.kind === "directory") {
    if (targetInodeKey && ctx.visitedInodes.has(targetInodeKey)) {
      // Already walked this directory via another path — not a hard failure.
      return;
    }
    if (targetInodeKey) {
      ctx.visitedInodes.add(targetInodeKey);
    }
    if (shouldPruneHiddenDir(ctx.plan.dotFiles, childRel)) {
      return;
    }
    if (ctx.ignore.isIgnored(childRel, true)) {
      return;
    }
    if (!matchesAnyGlob(childRel, true, ctx.includeGlobs)) {
      return;
    }
    childDirs.push(childRel);
    return;
  }

  if (targetInodeKey && ctx.visitedInodes.has(targetInodeKey)) {
    ctx.errors.push({
      class: "SymlinkLoop",
      message: `Symlink cycle detected at ${childRel}`,
      path: childRel,
    });
    return;
  }
  if (targetInodeKey) {
    ctx.visitedInodes.add(targetInodeKey);
  }

  if (targetStat.kind === "file") {
    await addFile(ctx, packageId, childRel, childAbs, targetStat, real, true);
  }
}

async function addFile(
  ctx: WalkContext,
  packageId: PackageId,
  childRel: RelativePosixPath,
  _childAbs: AbsoluteOsPath,
  st: { size: number; mtimeMs: number; device?: string; inode?: string },
  canonicalAbs: AbsoluteOsPath,
  viaSymlink: boolean,
): Promise<void> {
  if (ctx.ignore.isIgnored(childRel, false)) {
    return;
  }
  if (!matchesAnyGlob(childRel, false, ctx.includeGlobs)) {
    return;
  }

  const classified = classifyExtension(childRel);
  if (
    ctx.extensionSet.size > 0 &&
    classified.extension !== "" &&
    !ctx.extensionSet.has(classified.extension)
  ) {
    return;
  }
  if (classified.extension === "" || !ctx.extensionSet.has(classified.extension)) {
    return;
  }

  const caseKey = comparePathKey(childRel, ctx.plan.casePolicy);
  const existingCase = ctx.caseIndex.get(caseKey);
  if (existingCase !== undefined && existingCase !== childRel) {
    const canonicalId = ctx.pathIndex.get(existingCase);
    if (canonicalId) {
      ctx.conflicts.push({
        kind: "case-collision",
        paths: [existingCase, childRel],
        canonicalFileId: canonicalId,
        message: `Case-insensitive path collision between '${existingCase}' and '${childRel}'`,
      });
    }
    return;
  }
  ctx.caseIndex.set(caseKey, childRel);

  const canonicalRel =
    toRelativePosix(ctx.rootOs, canonicalAbs, ctx.plan.casePolicy) ?? childRel;
  const fileId = asFileId(canonicalRel);
  const inodeKey =
    st.device && st.inode ? `${st.device}:${st.inode}` : undefined;

  if (inodeKey) {
    const paths = ctx.inodePaths.get(inodeKey) ?? [];
    paths.push(childRel);
    ctx.inodePaths.set(inodeKey, paths);

    const existingId = ctx.inodeToFileId.get(inodeKey);
    if (existingId !== undefined && existingId !== fileId) {
      ctx.pathIndex.set(childRel, existingId);
      const heavy = ctx.heavyById.get(existingId);
      if (heavy) {
        ctx.heavyById.set(existingId, {
          ...heavy,
          locatorPaths: [...new Set([...heavy.locatorPaths, childRel])],
        });
      }
      ctx.conflicts.push({
        kind: "duplicate-locator",
        paths: [asRelativePosixPath(String(existingId)), childRel],
        canonicalFileId: existingId,
        message: `Duplicate physical file locator '${childRel}' → '${existingId}'`,
      });
      return;
    }
    ctx.inodeToFileId.set(inodeKey, fileId);
  }

  if (ctx.filesById.has(fileId)) {
    ctx.pathIndex.set(childRel, fileId);
    return;
  }

  const flags: FileFlag[] = [];
  if (viaSymlink || canonicalRel !== childRel) {
    flags.push("symlink");
  }
  if (isHiddenName(basenamePosix(canonicalRel))) {
    flags.push("hidden");
  }

  let contentState: LiteFileEntry["contentState"] = "available";
  if (st.size > ctx.plan.maxFileBytes) {
    contentState = "skipped-too-large";
    ctx.errors.push({
      class: "TooLarge",
      message: `File exceeds maxFileBytes (${st.size} > ${ctx.plan.maxFileBytes}): ${childRel}`,
      path: childRel,
    });
  }

  // Prefer canonical relative path so symlink aliases don't replace the real entry.
  ctx.filesById.set(fileId, {
    fileId,
    packageId,
    relativePath: canonicalRel,
    extension: classified.extension,
    language: classified.language,
    syntaxDomain: classified.syntaxDomain,
    role: classifyRole(canonicalRel),
    size: st.size,
    mtimeMs: st.mtimeMs,
    flags,
    contentState,
  });
  ctx.pathIndex.set(childRel, fileId);
  ctx.pathIndex.set(canonicalRel, fileId);
  ctx.absoluteById.set(fileId, canonicalAbs);
  ctx.heavyById.set(fileId, {
    fileId,
    realpath: canonicalAbs,
    device: st.device,
    inode: st.inode,
    locatorPaths: [...new Set([canonicalRel, childRel])],
    contentHash: undefined,
    encoding: undefined,
    statError: undefined,
  });
}

function isRevisitedInode(
  ctx: WalkContext,
  device: string | undefined,
  inode: string | undefined,
  pathRel: RelativePosixPath,
): boolean {
  if (!device || !inode) {
    return false;
  }
  const key = `${device}:${inode}`;
  if (ctx.visitedInodes.has(key)) {
    ctx.errors.push({
      class: "SymlinkLoop",
      message: `Directory inode already visited (possible cycle): ${pathRel}`,
      path: pathRel,
    });
    return true;
  }
  ctx.visitedInodes.add(key);
  return false;
}

function shouldPruneHiddenDir(
  policy: DiscoveryPlan["dotFiles"],
  relative: RelativePosixPath,
): boolean {
  if (policy !== "prune-dot-dirs" || relative === "") {
    return false;
  }
  return isHiddenName(basenamePosix(relative));
}

async function resolvePackages(
  fs: FileSystemPort,
  plan: DiscoveryPlan,
  scope: ScanScope,
  errors: ScannerErrorRecord[],
): Promise<PackageUnit[]> {
  const rootOs = plan.root.osPath;
  let roots = [...plan.packageRoots];

  if (scope.kind === "packages") {
    const wanted = new Set(scope.packageIds.map(String));
    roots = roots.filter((r) => wanted.has(r === "" ? "." : r));
  } else if (scope.kind === "paths") {
    roots = [...scope.paths];
  }

  const packages: PackageUnit[] = [];
  for (const root of roots) {
    const packageId = asPackageId(root === "" ? "." : root);
    let name: string | undefined;
    let manifestPath: RelativePosixPath | undefined;
    const manifestRel =
      root === ""
        ? asRelativePosixPath("package.json")
        : joinPosix(root, "package.json");
    const manifestAbs = toOsPath(rootOs, manifestRel);
    if (await fs.exists(manifestAbs)) {
      manifestPath = manifestRel;
      const text = await readTextFile(fs, manifestAbs, GITIGNORE_READ_LIMIT);
      if (text) {
        try {
          const json = JSON.parse(text) as { name?: string };
          name = json.name;
        } catch {
          errors.push({
            class: "Other",
            message: `Invalid package.json at ${manifestRel}`,
            path: manifestRel,
          });
        }
      }
    }

    packages.push({
      packageId,
      name,
      root,
      kind:
        root === "" && plan.packageRoots.length <= 1
          ? "singleton"
          : "workspace-package",
      manifestPath,
      manager: "unknown",
      fileIds: [],
    });
  }
  return packages;
}

function buildHardLinkGroups(
  inodePaths: Map<string, RelativePosixPath[]>,
  inodeToFileId: Map<string, FileId>,
): HardLinkGroup[] {
  const groups: HardLinkGroup[] = [];
  for (const [key, paths] of inodePaths) {
    if (paths.length < 2) {
      continue;
    }
    const [device, inode] = key.split(":");
    const fileId = inodeToFileId.get(key);
    if (!device || !inode || !fileId) {
      continue;
    }
    groups.push({ device, inode, fileIds: [fileId] });
  }
  return groups;
}

function recordFsError(
  errors: ScannerErrorRecord[],
  unreadableRoots: RelativePosixPath[],
  pathRel: RelativePosixPath,
  error: unknown,
): void {
  if (isErrno(error, "ENOENT")) {
    errors.push({
      class: "NotFound",
      message: `Path not found during scan: ${pathRel}`,
      path: pathRel,
    });
    return;
  }
  if (isErrno(error, "EACCES") || isErrno(error, "EPERM")) {
    errors.push({
      class: "PermissionDenied",
      message: `Permission denied: ${pathRel}`,
      path: pathRel,
    });
    unreadableRoots.push(pathRel);
    return;
  }
  errors.push({
    class: "Other",
    message: `Filesystem error at ${pathRel}: ${errorMessage(error)}`,
    path: pathRel,
  });
}

function countErrors(
  errors: readonly ScannerErrorRecord[],
): CoverageReport["errorsByClass"] {
  const out: Record<string, number> = {};
  for (const error of errors) {
    out[error.class] = (out[error.class] ?? 0) + 1;
  }
  return out;
}
