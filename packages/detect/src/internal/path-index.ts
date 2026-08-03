import { FRAMEWORK_SPECS, I18N_SPECS, PACKAGE_MANAGER_LOCKFILES } from "./catalogs.js";

/** Segments that should not host framework router roots (app/, pages/). */
const BANNED_ROUTER_PARENTS = new Set([
  "components",
  "component",
  "lib",
  "libs",
  "utils",
  "hooks",
  "helpers",
  "shared",
  "common",
  "ui",
  "features",
  "modules",
  "widgets",
  "containers",
  "assets",
  "static",
  "public",
  "test",
  "tests",
  "__tests__",
  "fixtures",
  "mocks",
]);

/** Canonical relative paths we care about for detection signals. */
export function buildInterestingPathSet(): {
  files: ReadonlySet<string>;
  dirs: ReadonlySet<string>;
} {
  const files = new Set<string>([
    "package.json",
    "tsconfig.json",
    "tsconfig.base.json",
    "jsconfig.json",
    "angular.json",
    "app.json",
    "app.config.js",
    "app.config.ts",
    "app.config.mjs",
    "expo.json",
  ]);
  const dirs = new Set<string>();

  for (const pm of PACKAGE_MANAGER_LOCKFILES) {
    for (const file of pm.files) {
      files.add(file);
    }
  }
  for (const fw of FRAMEWORK_SPECS) {
    for (const file of fw.configFiles) {
      files.add(file);
    }
    for (const dir of fw.directories) {
      dirs.add(dir);
    }
  }
  for (const lib of I18N_SPECS) {
    for (const file of lib.initFiles) {
      files.add(file.path);
      if (file.directory) {
        dirs.add(file.path);
      }
    }
  }

  for (const dir of ["app", "pages", "src/app", "src/pages"]) {
    dirs.add(dir);
  }

  return { files, dirs };
}

export interface PathIndex {
  readonly present: Set<string>;
  readonly signals: Set<string>;
  readonly examples: Map<string, string>;
}

export function createPathIndex(): PathIndex {
  return {
    present: new Set(),
    signals: new Set(),
    examples: new Map(),
  };
}

export function indexRelativePath(
  index: PathIndex,
  relativePath: string,
  interesting: { files: ReadonlySet<string>; dirs: ReadonlySet<string> },
): void {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized) {
    return;
  }

  index.present.add(normalized);
  markFileSignals(index, normalized, interesting.files);

  const parts = normalized.split("/");
  for (let i = 1; i < parts.length; i += 1) {
    const dir = parts.slice(0, i).join("/");
    index.present.add(dir);
    markDirSignals(index, dir, interesting.dirs);
  }
}

function markFileSignals(
  index: PathIndex,
  relativePath: string,
  interestingFiles: ReadonlySet<string>,
): void {
  const parts = relativePath.split("/");
  for (let i = 0; i < parts.length; i += 1) {
    const suffix = parts.slice(i).join("/");
    if (interestingFiles.has(suffix)) {
      addSignal(index, suffix, relativePath);
    }
  }
  const base = parts[parts.length - 1] ?? "";
  if (
    base === "tsconfig.json" ||
    base === "tsconfig.base.json" ||
    /^tsconfig\.[^/]+\.json$/.test(base)
  ) {
    addSignal(index, base, relativePath);
  }
}

function markDirSignals(
  index: PathIndex,
  dirPath: string,
  interestingDirs: ReadonlySet<string>,
): void {
  for (const interesting of interestingDirs) {
    if (isCanonicalDirMatch(dirPath, interesting)) {
      addSignal(index, interesting, dirPath);
    }
  }
}

/**
 * Match framework/i18n directories at repo root or under package roots,
 * without treating `components/app` as Next.js App Router.
 */
export function isCanonicalDirMatch(dirPath: string, interesting: string): boolean {
  if (dirPath === interesting) {
    return true;
  }
  if (!dirPath.endsWith(`/${interesting}`)) {
    return false;
  }

  const prefix = dirPath.slice(0, -(interesting.length + 1));
  const parent = prefix.includes("/")
    ? prefix.slice(prefix.lastIndexOf("/") + 1)
    : prefix;

  if (interesting === "app" || interesting === "pages") {
    if (BANNED_ROUTER_PARENTS.has(parent)) {
      return false;
    }
  }

  return true;
}

function addSignal(index: PathIndex, canonical: string, example: string): void {
  index.signals.add(canonical);
  if (!index.examples.has(canonical)) {
    index.examples.set(canonical, example);
  }
}

export function hasSignal(index: PathIndex, canonical: string): boolean {
  return index.signals.has(canonical) || index.present.has(canonical);
}

export function signalExample(
  index: PathIndex,
  canonical: string,
): string | undefined {
  return (
    index.examples.get(canonical) ??
    (index.present.has(canonical) ? canonical : undefined)
  );
}
