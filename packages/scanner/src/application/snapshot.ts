import {
  PROJECT_MODEL_VERSION,
  SCANNER_VERSION,
} from "../config/defaults.js";
import type { FileId } from "../domain/ids.js";
import type {
  ContentHash,
  HeavyFileMetadata,
  LiteFileEntry,
} from "../domain/metadata.js";
import type { DiscoveryPlan } from "../domain/plan.js";
import type { RelativePosixPath } from "../domain/paths.js";
import type {
  ContentAccessor,
  ContentReadResult,
  FileFilter,
  ProjectSnapshotView,
} from "../domain/snapshot.js";
import type { FileSystemPort } from "../ports/filesystem.js";
import { looksBinary, sha256 } from "../infrastructure/node-fs.js";
import { errorMessage } from "./errors.js";
import type { WalkResult } from "./walker.js";

export function createSnapshotView(
  plan: DiscoveryPlan,
  walk: WalkResult,
  fs: FileSystemPort,
): ProjectSnapshotView {
  const filesById = walk.filesById;
  const heavyById = new Map(walk.heavyById);
  const pathIndex = walk.pathIndex;
  const absoluteById = walk.absoluteById;

  const content: ContentAccessor = {
    async read(fileId: FileId): Promise<ContentReadResult> {
      const lite = filesById.get(fileId);
      if (!lite) {
        return {
          ok: false,
          reason: "missing",
          message: `Unknown file id: ${fileId}`,
        };
      }
      if (lite.contentState === "skipped-too-large") {
        return {
          ok: false,
          reason: "too-large",
          message: `File exceeds maxFileBytes: ${lite.relativePath}`,
        };
      }
      if (lite.contentState === "skipped-binary") {
        return {
          ok: false,
          reason: "binary",
          message: `Binary content skipped: ${lite.relativePath}`,
        };
      }

      const abs = absoluteById.get(fileId);
      if (!abs) {
        return {
          ok: false,
          reason: "missing",
          message: `No absolute path for ${fileId}`,
        };
      }

      try {
        const bytes = await fs.readFile(abs, plan.maxFileBytes);
        if (looksBinary(bytes)) {
          updateContentState(filesById, fileId, "skipped-binary");
          return {
            ok: false,
            reason: "binary",
            message: `Binary content skipped: ${lite.relativePath}`,
          };
        }
        return { ok: true, bytes, encoding: "utf8" };
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          (error as { code: string }).code === "FILE_TOO_LARGE"
        ) {
          updateContentState(filesById, fileId, "skipped-too-large");
          return { ok: false, reason: "too-large", message: error.message };
        }
        updateContentState(filesById, fileId, "unreadable");
        return {
          ok: false,
          reason: "unreadable",
          message: `Unable to read ${lite.relativePath}: ${errorMessage(error)}`,
        };
      }
    },

    async hash(fileId: FileId): Promise<ContentHash | undefined> {
      if (plan.hash === "never") {
        return undefined;
      }
      const existing = heavyById.get(fileId)?.contentHash;
      if (existing) {
        return existing;
      }
      const result = await content.read(fileId);
      if (!result.ok) {
        return undefined;
      }
      const digest: ContentHash = {
        algorithm: "sha256",
        digest: sha256(result.bytes),
      };
      const heavy = heavyById.get(fileId);
      if (heavy) {
        heavyById.set(fileId, {
          ...heavy,
          contentHash: digest,
          encoding: "utf8",
        });
      }
      return digest;
    },
  };

  return {
    projectModelVersion: PROJECT_MODEL_VERSION,
    root: plan.root,
    scannedAt: new Date().toISOString(),
    planDigest: plan.planDigest,
    scannerVersion: SCANNER_VERSION,
    casePolicy: plan.casePolicy,
    packages: walk.packages,
    coverage: walk.coverage,
    errors: walk.errors,
    conflicts: walk.conflicts,
    hardLinkGroups: walk.hardLinkGroups,
    signals: walk.signals,
    *files(filter?: FileFilter): IterableIterator<LiteFileEntry> {
      for (const entry of filesById.values()) {
        if (matchesFilter(entry, filter)) {
          yield entry;
        }
      }
    },
    get(fileId: FileId): LiteFileEntry | undefined {
      return filesById.get(fileId);
    },
    heavy(fileId: FileId): HeavyFileMetadata | undefined {
      return heavyById.get(fileId);
    },
    lookup(path: RelativePosixPath): FileId | undefined {
      return pathIndex.get(path);
    },
    content,
  };
}

function matchesFilter(entry: LiteFileEntry, filter?: FileFilter): boolean {
  if (!filter) {
    return true;
  }
  if (filter.packageId !== undefined && entry.packageId !== filter.packageId) {
    return false;
  }
  if (
    filter.syntaxDomain !== undefined &&
    entry.syntaxDomain !== filter.syntaxDomain
  ) {
    return false;
  }
  if (filter.role !== undefined && entry.role !== filter.role) {
    return false;
  }
  if (
    filter.extensions !== undefined &&
    !filter.extensions.includes(entry.extension)
  ) {
    return false;
  }
  return true;
}

function updateContentState(
  filesById: Map<FileId, LiteFileEntry>,
  fileId: FileId,
  state: LiteFileEntry["contentState"],
): void {
  const current = filesById.get(fileId);
  if (!current) {
    return;
  }
  filesById.set(fileId, { ...current, contentState: state });
}
