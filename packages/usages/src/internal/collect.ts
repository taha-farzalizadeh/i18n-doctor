import { createAstEngine, isSupportedSourceFileName } from "@i18n-unused/ast";
import type { LiteFileEntry, ProjectSnapshotView } from "@i18n-unused/scanner";
import type {
  TranslationUsage,
  UsageLibraryId,
  UsageWarning,
} from "../api/types.js";
import { analyzeFileAliases } from "./alias-resolve.js";
import { buildFileBindings } from "./bindings.js";
import { LIBRARY_USAGE_DETECTORS } from "./detectors/index.js";
import { offsetUsages, resolveAbsolutePath } from "./location.js";
import {
  extractVueScripts,
  scanAngularTemplateUsages,
  scanVueTemplateUsages,
} from "./template-scan.js";

const MAX_FILE_BYTES = 1.5 * 1024 * 1024;
const ANALYZE_CONCURRENCY = 8;

const SCRIPT_EXT = new Set([
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "mts",
  "cts",
]);

export async function collectUsages(input: {
  root: string;
  snapshot: ProjectSnapshotView;
  libraryHints: ReadonlySet<string>;
  minConfidence: number;
  maxFiles: number;
  scanTemplates: boolean;
  warnings: UsageWarning[];
}): Promise<{ usages: TranslationUsage[]; fileCount: number }> {
  const candidates = selectFiles(input.snapshot, input.maxFiles);
  const engine = createAstEngine({ cache: true, concurrency: 4 });
  const usages: TranslationUsage[] = [];
  let fileCount = 0;

  await mapPool(candidates, ANALYZE_CONCURRENCY, async (file) => {
    fileCount += 1;
    try {
      const read = await input.snapshot.content.read(file.fileId);
      if (!read.ok) {
        input.warnings.push({
          code: "read-failed",
          message: `Could not read ${file.relativePath}`,
          path: file.relativePath,
        });
        return;
      }
      if (read.bytes.byteLength > MAX_FILE_BYTES) {
        input.warnings.push({
          code: "file-too-large",
          message: `Skipping ${file.relativePath}: exceeds size limit`,
          path: file.relativePath,
        });
        return;
      }
      const sourceText = Buffer.from(read.bytes).toString("utf8");
      const absolutePath = resolveAbsolutePath(input.root, file.relativePath);
      const relativePath = file.relativePath;

      if (file.extension === "vue") {
        if (input.scanTemplates) {
          for (const u of scanVueTemplateUsages({
            absolutePath,
            relativePath,
            sourceText,
          })) {
            if (u.confidence >= input.minConfidence) {
              usages.push(u);
            }
          }
        }
        for (const script of extractVueScripts(sourceText)) {
          const fileName = `${relativePath}.${script.lang}`;
          const scriptUsages = analyzeScript({
            absolutePath,
            relativePath,
            sourceText: script.text,
            fileName,
            engine,
            libraryHints: input.libraryHints,
            minConfidence: input.minConfidence,
          });
          usages.push(
            ...offsetUsages(scriptUsages, sourceText, script.offset),
          );
        }
        return;
      }

      if (
        (file.extension === "html" || file.extension === "htm") &&
        input.scanTemplates
      ) {
        const lib: UsageLibraryId = input.libraryHints.has("transloco")
          ? "transloco"
          : "ngx-translate";
        for (const u of scanAngularTemplateUsages({
          absolutePath,
          relativePath,
          sourceText,
          library: lib,
        })) {
          if (u.confidence >= input.minConfidence) {
            usages.push(u);
          }
        }
        return;
      }

      if (
        !SCRIPT_EXT.has(file.extension) ||
        !isSupportedSourceFileName(relativePath)
      ) {
        return;
      }

      const scriptUsages = analyzeScript({
        absolutePath,
        relativePath,
        sourceText,
        fileName: relativePath,
        engine,
        libraryHints: input.libraryHints,
        minConfidence: input.minConfidence,
      });
      usages.push(...scriptUsages);
    } catch (error) {
      input.warnings.push({
        code: "analyze-failed",
        message: `Failed analyzing ${file.relativePath}: ${error instanceof Error ? error.message : String(error)}`,
        path: file.relativePath,
      });
    }
  });

  return { usages, fileCount };
}

function analyzeScript(input: {
  absolutePath: string;
  relativePath: string;
  sourceText: string;
  fileName: string;
  engine: ReturnType<typeof createAstEngine>;
  libraryHints: ReadonlySet<string>;
  minConfidence: number;
}): TranslationUsage[] {
  const parsed = input.engine.parse({
    fileName: input.fileName,
    sourceText: input.sourceText,
  });
  // Malformed files still yield a best-effort AST — never throw.
  const bindings = buildFileBindings(parsed.sourceFile);
  const aliasAnalysis = analyzeFileAliases(
    parsed.sourceFile,
    input.fileName,
  );
  const found: TranslationUsage[] = [];
  const seen = new Set<string>();

  for (const detector of LIBRARY_USAGE_DETECTORS) {
    const hits = detector.detect({
      absolutePath: input.absolutePath,
      relativePath: input.relativePath,
      sourceText: input.sourceText,
      sourceFile: parsed.sourceFile,
      bindings,
      aliasAnalysis,
      libraryHints: input.libraryHints,
    });
    for (const usage of hits) {
      if (usage.confidence < input.minConfidence) {
        continue;
      }
      const dedupeKey = `${usage.relativePath}:${usage.location.start}:${usage.location.end}:${usage.key}:${usage.library}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      found.push(usage);
    }
  }
  return found;
}

function selectFiles(
  snapshot: ProjectSnapshotView,
  maxFiles: number,
): LiteFileEntry[] {
  const files: LiteFileEntry[] = [];
  for (const file of snapshot.files()) {
    if (file.role === "generated") {
      continue;
    }
    if (
      /(^|\/)(\.next|\.nuxt|dist|build|out|coverage|generated)(\/|$)/i.test(
        file.relativePath,
      )
    ) {
      continue;
    }
    const ext = file.extension;
    if (
      SCRIPT_EXT.has(ext) ||
      ext === "vue" ||
      ext === "html" ||
      ext === "htm"
    ) {
      files.push(file);
    }
    if (files.length >= maxFiles) {
      break;
    }
  }
  return files;
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
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        await fn(items[index]!);
      }
    }),
  );
}
