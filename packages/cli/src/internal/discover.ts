/**
 * Resolve the project root for analysis.
 * Walks up from the start path until package.json (or filesystem root).
 */

import fs from "node:fs";
import path from "node:path";
import { CliError, cliErrorFromErrno } from "./errors.js";
import { normalizeAbsolute, pathsEqual, relativePosix } from "./paths.js";

export interface DiscoverFs {
  readonly existsSync: (p: string) => boolean;
  readonly statSync: (p: string) => { isDirectory(): boolean };
  readonly accessSync?: (p: string, mode?: number) => void;
}

export interface DiscoverProjectOptions {
  /** Explicit path argument from the CLI. */
  readonly pathArg?: string;
  /** --cwd override. */
  readonly cwd?: string;
  /** Injectable FS for tests. */
  readonly fs?: DiscoverFs;
}

export interface DiscoveredProject {
  /** Absolute analysis root. */
  readonly root: string;
  /** Absolute path that was requested (before walk-up). */
  readonly startPath: string;
  /** Whether root was found by walking up for package.json. */
  readonly walkedUp: boolean;
  /**
   * When the requested path is a subdirectory of {@link root}, POSIX-relative
   * path from root to that directory (e.g. `src/auth`). Omitted for full-project scans.
   */
  readonly scanDir?: string;
}

const defaultFs: DiscoverFs = {
  existsSync: (p) => fs.existsSync(p),
  statSync: (p) => fs.statSync(p),
  accessSync: (p, mode) => fs.accessSync(p, mode),
};

export function discoverProject(
  options: DiscoverProjectOptions = {},
): DiscoveredProject {
  const io = options.fs ?? defaultFs;
  const cwd = normalizeAbsolute(options.cwd ?? process.cwd());
  const startPath = options.pathArg
    ? normalizeAbsolute(path.resolve(cwd, options.pathArg))
    : cwd;

  try {
    if (!io.existsSync(startPath)) {
      throw new CliError("NOT_FOUND", `Path does not exist: ${startPath}`, {
        hint: "Pass an existing project directory to `i18n-doctor check`.",
      });
    }

    // Probe readability early (permission errors).
    if (io.accessSync) {
      io.accessSync(startPath, fs.constants.R_OK);
    }

    const startStat = io.statSync(startPath);
    const startDir = startStat.isDirectory()
      ? startPath
      : path.dirname(startPath);

    if (io.accessSync) {
      io.accessSync(startDir, fs.constants.R_OK);
    }

    const root = findPackageRoot(startDir, io);
    const scanDir = computeScanDir(root, startDir);
    return {
      root,
      startPath: startDir,
      walkedUp: !pathsEqual(root, startDir),
      ...(scanDir !== undefined ? { scanDir } : {}),
    };
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw cliErrorFromErrno(error, `Cannot access project path ${startPath}`);
  }
}

function findPackageRoot(startDir: string, io: DiscoverFs): string {
  let current = normalizeAbsolute(startDir);
  for (;;) {
    if (io.existsSync(path.join(current, "package.json"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return normalizeAbsolute(startDir);
    }
    current = parent;
  }
}

function computeScanDir(root: string, startDir: string): string | undefined {
  if (pathsEqual(root, startDir)) {
    return undefined;
  }
  const rel = relativePosix(root, startDir);
  if (rel === ".." || rel.startsWith("../")) {
    return undefined;
  }
  return rel.length > 0 ? rel : undefined;
}

/** Ensure an explicit --config path exists and is readable. */
export function assertConfigReadable(
  configPath: string,
  cwd: string,
  io: DiscoverFs = defaultFs,
): string {
  const absolute = path.isAbsolute(configPath)
    ? normalizeAbsolute(configPath)
    : normalizeAbsolute(path.resolve(cwd, configPath));
  try {
    if (!io.existsSync(absolute)) {
      throw new CliError(
        "NOT_FOUND",
        `Config file not found: ${absolute}`,
        { hint: "Pass a valid path to --config." },
      );
    }
    if (io.accessSync) {
      io.accessSync(absolute, fs.constants.R_OK);
    }
    return absolute;
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw cliErrorFromErrno(error, `Cannot read config ${absolute}`);
  }
}
