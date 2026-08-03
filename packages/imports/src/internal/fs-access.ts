import fs from "node:fs";
import type { ImportResolverOptions } from "../api/types.js";

export interface FsAccess {
  fileExists(absolutePath: string): boolean;
  readFile(absolutePath: string): string | undefined;
}

export function createFsAccess(options: ImportResolverOptions): FsAccess {
  return {
    fileExists(absolutePath: string): boolean {
      if (options.fileExists) {
        return options.fileExists(absolutePath);
      }
      try {
        return fs.statSync(absolutePath).isFile();
      } catch {
        return false;
      }
    },
    readFile(absolutePath: string): string | undefined {
      if (options.readFile) {
        return options.readFile(absolutePath);
      }
      try {
        return fs.readFileSync(absolutePath, "utf8");
      } catch {
        return undefined;
      }
    },
  };
}
