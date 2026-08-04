import path from "node:path";
import { createAstEngine, traversalApi } from "@i18n-doctor/ast";
import {
  createScanner,
  type LiteFileEntry,
  type ProjectSnapshotView,
} from "@i18n-doctor/scanner";
import ts from "typescript";
import type { DetectionWarning } from "../api/types.js";
import {
  PACKAGE_MANAGER_LOCKFILES,
  FRAMEWORK_SPECS,
  I18N_SPECS,
  PRIORITY_SOURCE_BASENAMES,
  PROVIDER_IDENTIFIERS,
} from "./catalogs.js";
import { probeRootFiles, readTextIfExists } from "./fs-signals.js";
import {
  buildInterestingPathSet,
  createPathIndex,
  hasSignal,
  indexRelativePath,
  signalExample,
  type PathIndex,
} from "./path-index.js";

const MAX_SOURCE_BYTES = 512 * 1024;
const IMPORT_SCAN_CONCURRENCY = 6;

export interface PackageJsonInfo {
  readonly path: string;
  readonly name?: string;
  readonly packageManager?: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
  readonly peerDependencies: Readonly<Record<string, string>>;
  readonly optionalDependencies: Readonly<Record<string, string>>;
  readonly scripts: Readonly<Record<string, string>>;
  readonly workspaces?: unknown;
}

export interface DetectionContext {
  readonly root: string;
  readonly snapshot: ProjectSnapshotView;
  readonly packageJsons: readonly PackageJsonInfo[];
  /** @deprecated Prefer pathIndex; retained for signal checks. */
  readonly presentPaths: ReadonlySet<string>;
  readonly pathIndex: PathIndex;
  readonly importSpecifiers: ReadonlyMap<string, string[]>;
  readonly sourceIdentifiers: ReadonlySet<string>;
  readonly flags: {
    readonly expoManifest: boolean;
    readonly packageJsonCount: number;
  };
  readonly warnings: DetectionWarning[];
  readonly scanMs: number;
}

export async function collectContext(
  rootInput: string,
  options: { maxSourceFiles: number; scanImports: boolean },
): Promise<DetectionContext> {
  const root = path.resolve(rootInput);
  const warnings: DetectionWarning[] = [];
  const scanStarted = performance.now();
  const interesting = buildInterestingPathSet();
  const pathIndex = createPathIndex();

  let snapshot: ProjectSnapshotView;
  try {
    snapshot = await scanProject(root);
  } catch (error) {
    warnings.push({
      code: "scan-failed",
      message: `Project scan failed: ${errorMessage(error)}. Falling back to empty file set.`,
      path: root,
    });
    try {
      snapshot = await scanProject(root, { packages: ["."] });
    } catch (inner) {
      warnings.push({
        code: "scan-unavailable",
        message: `Unable to scan project at all: ${errorMessage(inner)}`,
        path: root,
      });
      return {
        root,
        snapshot: emptySnapshotStub(root),
        packageJsons: [],
        presentPaths: pathIndex.present,
        pathIndex,
        importSpecifiers: new Map(),
        sourceIdentifiers: new Set(),
        flags: { expoManifest: false, packageJsonCount: 0 },
        warnings,
        scanMs: performance.now() - scanStarted,
      };
    }
  }

  const scanMs = performance.now() - scanStarted;

  for (const file of snapshot.files()) {
    indexRelativePath(pathIndex, file.relativePath, interesting);
  }

  try {
    const probed = await probeRootFiles(root, collectProbePaths());
    for (const p of probed) {
      indexRelativePath(pathIndex, p, interesting);
    }
  } catch (error) {
    warnings.push({
      code: "root-probe-failed",
      message: `Root file probe failed: ${errorMessage(error)}`,
      path: root,
    });
  }

  const packageJsons: PackageJsonInfo[] = [];
  for (const file of snapshot.files({ extensions: ["json"] })) {
    if (!file.relativePath.endsWith("package.json")) {
      continue;
    }
    try {
      const read = await snapshot.content.read(file.fileId);
      if (!read.ok) {
        warnings.push({
          code: "package-json-unreadable",
          message: `Could not read ${file.relativePath}`,
          path: file.relativePath,
        });
        continue;
      }
      const text = Buffer.from(read.bytes).toString("utf8");
      const parsed = parsePackageJson(text, file.relativePath, warnings);
      if (parsed) {
        packageJsons.push(parsed);
      }
    } catch (error) {
      warnings.push({
        code: "package-json-invalid",
        message: `Invalid package.json at ${file.relativePath}: ${errorMessage(error)}`,
        path: file.relativePath,
      });
    }
  }

  // Root package.json may be omitted from candidate set in some edge scans — probe it.
  if (!packageJsons.some((p) => p.path === "package.json")) {
    const rootPkgText = await readTextIfExists(root, "package.json", 1024 * 1024);
    if (rootPkgText !== undefined) {
      const parsed = parsePackageJson(rootPkgText, "package.json", warnings);
      if (parsed) {
        packageJsons.push(parsed);
        indexRelativePath(pathIndex, "package.json", interesting);
      }
    }
  }

  if (packageJsons.length > 1) {
    warnings.push({
      code: "monorepo-packages",
      message: `Found ${packageJsons.length} package.json files; detection aggregates workspace signals.`,
    });
  }

  const expoManifest = await detectExpoManifest(root, pathIndex);

  const importSpecifiers = new Map<string, string[]>();
  const sourceIdentifiers = new Set<string>();

  if (options.scanImports) {
    await collectImportSignals(
      snapshot,
      options.maxSourceFiles,
      importSpecifiers,
      sourceIdentifiers,
      warnings,
    );
  }

  return {
    root,
    snapshot,
    packageJsons,
    presentPaths: pathIndex.present,
    pathIndex,
    importSpecifiers,
    sourceIdentifiers,
    flags: {
      expoManifest,
      packageJsonCount: packageJsons.length,
    },
    warnings,
    scanMs,
  };
}

async function scanProject(
  root: string,
  extra?: { packages?: string[] },
): Promise<ProjectSnapshotView> {
  const scanner = createScanner({
    config: {
      root,
      ignoreDefaults: true,
      useGitIgnore: true,
      hash: "never",
      completeness: "best-effort",
      ...(extra?.packages ? { packages: extra.packages } : {}),
    },
  });
  const plan = await scanner.buildPlan({
    root,
    ignoreDefaults: true,
    useGitIgnore: true,
    hash: "never",
    completeness: "best-effort",
    ...(extra?.packages ? { packages: extra.packages } : {}),
  });
  return scanner.scan(plan, { kind: "workspace" });
}

function parsePackageJson(
  text: string,
  relativePath: string,
  warnings: DetectionWarning[],
): PackageJsonInfo | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    warnings.push({
      code: "package-json-invalid",
      message: `Invalid package.json at ${relativePath}: ${errorMessage(error)}`,
      path: relativePath,
    });
    return undefined;
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    warnings.push({
      code: "package-json-invalid",
      message: `Invalid package.json at ${relativePath}: expected a JSON object`,
      path: relativePath,
    });
    return undefined;
  }
  const record = json as Record<string, unknown>;
  return {
    path: relativePath,
    ...(typeof record.name === "string" ? { name: record.name } : {}),
    ...(typeof record.packageManager === "string"
      ? { packageManager: record.packageManager }
      : {}),
    dependencies: asStringRecord(record.dependencies),
    devDependencies: asStringRecord(record.devDependencies),
    peerDependencies: asStringRecord(record.peerDependencies),
    optionalDependencies: asStringRecord(record.optionalDependencies),
    scripts: asStringRecord(record.scripts),
    ...(record.workspaces !== undefined ? { workspaces: record.workspaces } : {}),
  };
}

async function detectExpoManifest(
  root: string,
  pathIndex: PathIndex,
): Promise<boolean> {
  if (
    hasSignal(pathIndex, "app.config.js") ||
    hasSignal(pathIndex, "app.config.ts") ||
    hasSignal(pathIndex, "app.config.mjs") ||
    hasSignal(pathIndex, "expo.json")
  ) {
    return true;
  }
  if (!hasSignal(pathIndex, "app.json") && !pathIndex.present.has("app.json")) {
    return false;
  }
  const example = signalExample(pathIndex, "app.json") ?? "app.json";
  const text = await readTextIfExists(root, example, 256 * 1024);
  if (!text) {
    return false;
  }
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    return json.expo !== undefined && typeof json.expo === "object";
  } catch {
    // Non-JSON or corrupt — do not treat as Expo.
    return false;
  }
}

async function collectImportSignals(
  snapshot: ProjectSnapshotView,
  maxSourceFiles: number,
  importSpecifiers: Map<string, string[]>,
  sourceIdentifiers: Set<string>,
  warnings: DetectionWarning[],
): Promise<void> {
  const engine = createAstEngine({ cache: true, concurrency: IMPORT_SCAN_CONCURRENCY });
  const all: LiteFileEntry[] = [];
  for (const file of snapshot.files()) {
    if (!isScriptCandidate(file)) {
      continue;
    }
    all.push(file);
  }

  const candidates = selectSourceCandidates(all, maxSourceFiles);

  await mapPool(candidates, IMPORT_SCAN_CONCURRENCY, async (file) => {
    try {
      const read = await snapshot.content.read(file.fileId);
      if (!read.ok) {
        return;
      }
      if (read.bytes.byteLength > MAX_SOURCE_BYTES) {
        return;
      }
      const sourceText = Buffer.from(read.bytes).toString("utf8");
      const parsed = engine.parse({
        fileId: String(file.fileId),
        fileName: file.relativePath,
        sourceText,
      });

      traversalApi.forEachChild(parsed.sourceFile, (node) => {
        if (ts.isImportDeclaration(node) && node.moduleSpecifier) {
          if (ts.isStringLiteral(node.moduleSpecifier)) {
            addSpecifier(
              importSpecifiers,
              node.moduleSpecifier.text,
              file.relativePath,
            );
          }
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
          if (ts.isStringLiteral(node.moduleSpecifier)) {
            addSpecifier(
              importSpecifiers,
              node.moduleSpecifier.text,
              file.relativePath,
            );
          }
        } else if (
          ts.isCallExpression(node) &&
          node.expression.kind === ts.SyntaxKind.ImportKeyword &&
          node.arguments[0] &&
          ts.isStringLiteral(node.arguments[0])
        ) {
          addSpecifier(
            importSpecifiers,
            node.arguments[0].text,
            file.relativePath,
          );
        } else if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "require" &&
          node.arguments[0] &&
          ts.isStringLiteral(node.arguments[0])
        ) {
          addSpecifier(
            importSpecifiers,
            node.arguments[0].text,
            file.relativePath,
          );
        } else if (ts.isIdentifier(node)) {
          if (PROVIDER_IDENTIFIERS.has(node.text)) {
            sourceIdentifiers.add(node.text);
          }
        } else if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const tag = node.tagName.getText(parsed.sourceFile);
          if (PROVIDER_IDENTIFIERS.has(tag)) {
            sourceIdentifiers.add(tag);
          }
        }
      });
    } catch (error) {
      warnings.push({
        code: "import-scan-failed",
        message: `Failed scanning imports in ${file.relativePath}: ${errorMessage(error)}`,
        path: file.relativePath,
      });
    }
  });
}

function isScriptCandidate(file: LiteFileEntry): boolean {
  if (file.relativePath.endsWith(".d.ts")) {
    return false;
  }
  const ext = file.extension;
  return (
    ext === "js" ||
    ext === "jsx" ||
    ext === "ts" ||
    ext === "tsx" ||
    ext === "mjs" ||
    ext === "cjs" ||
    ext === "mts" ||
    ext === "cts"
  );
}

function selectSourceCandidates(
  files: readonly LiteFileEntry[],
  max: number,
): LiteFileEntry[] {
  if (files.length <= max) {
    return [...files];
  }
  const scored = files.map((file, order) => ({
    file,
    order,
    score: sourcePriorityScore(file.relativePath),
  }));
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.slice(0, max).map((s) => s.file);
}

function sourcePriorityScore(relativePath: string): number {
  const base = relativePath.slice(relativePath.lastIndexOf("/") + 1).toLowerCase();
  let score = 0;
  if (PRIORITY_SOURCE_BASENAMES.has(base)) {
    score += 100;
  }
  if (/(^|\/)(i18n|locale|locales|lang|messages)(\/|$)/i.test(relativePath)) {
    score += 40;
  }
  if (/(^|\/)(app|pages|src)(\/|$)/i.test(relativePath)) {
    score += 10;
  }
  if (relativePath.includes("node_modules")) {
    score -= 1000;
  }
  return score;
}

async function mapPool<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        await fn(items[index]!);
      }
    },
  );
  await Promise.all(workers);
}

function addSpecifier(
  map: Map<string, string[]>,
  specifier: string,
  filePath: string,
): void {
  const list = map.get(specifier) ?? [];
  if (list.length < 5) {
    list.push(filePath);
  }
  map.set(specifier, list);
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") {
      out[k] = v;
    }
  }
  return out;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function collectProbePaths(): string[] {
  const paths = new Set<string>([
    "package.json",
    "tsconfig.json",
    "jsconfig.json",
    "angular.json",
    "app.json",
  ]);
  for (const pm of PACKAGE_MANAGER_LOCKFILES) {
    for (const file of pm.files) {
      paths.add(file);
    }
  }
  for (const fw of FRAMEWORK_SPECS) {
    for (const file of fw.configFiles) {
      paths.add(file);
    }
  }
  for (const lib of I18N_SPECS) {
    for (const init of lib.initFiles) {
      if (!init.directory) {
        paths.add(init.path);
      }
    }
  }
  return [...paths];
}

function emptySnapshotStub(root: string): ProjectSnapshotView {
  return {
    projectModelVersion: 1,
    root: {
      kind: "posix",
      osPath: root as never,
      digest: `fallback:${root}`,
    },
    scannedAt: new Date().toISOString(),
    planDigest: "unavailable",
    scannerVersion: "0.0.0",
    casePolicy: "sensitive",
    packages: [],
    coverage: {
      complete: false,
      packagesScanned: [],
      packagesSkipped: [],
      filesCandidateCount: 0,
      errorsByClass: {},
      unreadableRoots: [],
      zeroCandidates: true,
      symlinkEscapesBlocked: 0,
    },
    errors: [],
    conflicts: [],
    hardLinkGroups: [],
    signals: [],
    *files() {},
    get() {
      return undefined;
    },
    heavy() {
      return undefined;
    },
    lookup() {
      return undefined;
    },
    content: {
      async read() {
        return { ok: false, reason: "missing", message: "unavailable" };
      },
      async hash() {
        return undefined;
      },
    },
  };
}

export function hasPath(ctx: DetectionContext, relative: string): boolean {
  return hasSignal(ctx.pathIndex, relative);
}

export function hasDependency(
  packages: readonly PackageJsonInfo[],
  name: string,
  section: "dependency" | "devDependency" | "peerDependency" | "any" = "any",
): { found: boolean; path?: string; section?: string } {
  for (const pkg of packages) {
    if (section === "dependency" || section === "any") {
      if (name in pkg.dependencies) {
        return { found: true, path: pkg.path, section: "dependency" };
      }
    }
    if (section === "devDependency" || section === "any") {
      if (name in pkg.devDependencies) {
        return { found: true, path: pkg.path, section: "devDependency" };
      }
    }
    if (section === "peerDependency" || section === "any") {
      if (name in pkg.peerDependencies) {
        return { found: true, path: pkg.path, section: "peerDependency" };
      }
    }
    if (section === "any" && name in pkg.optionalDependencies) {
      return { found: true, path: pkg.path, section: "optionalDependency" };
    }
  }
  return { found: false };
}

export function findImport(
  imports: ReadonlyMap<string, string[]>,
  specifier: string,
): string[] {
  const exact = imports.get(specifier);
  if (exact) {
    return exact;
  }
  const hits: string[] = [];
  for (const [key, paths] of imports) {
    if (key === specifier || key.startsWith(`${specifier}/`)) {
      for (const p of paths) {
        if (hits.length >= 5) {
          return hits;
        }
        hits.push(p);
      }
    }
  }
  return hits;
}
