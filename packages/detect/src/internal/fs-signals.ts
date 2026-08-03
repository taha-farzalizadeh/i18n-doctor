import { access, readFile } from "node:fs/promises";
import path from "node:path";

export async function pathExists(root: string, relative: string): Promise<boolean> {
  try {
    await access(path.join(root, relative));
    return true;
  } catch {
    return false;
  }
}

export async function readTextIfExists(
  root: string,
  relative: string,
  maxBytes = 1024 * 1024,
): Promise<string | undefined> {
  try {
    const buf = await readFile(path.join(root, relative));
    if (buf.byteLength > maxBytes) {
      return buf.subarray(0, maxBytes).toString("utf8");
    }
    return buf.toString("utf8");
  } catch {
    return undefined;
  }
}

/** Probe common root-level files the scanner may not classify as candidates. */
export async function probeRootFiles(
  root: string,
  relatives: readonly string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  await Promise.all(
    relatives.map(async (relative) => {
      if (await pathExists(root, relative)) {
        found.add(relative);
      }
    }),
  );
  return found;
}
