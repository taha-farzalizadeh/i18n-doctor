import { createAstEngine, isSupportedSourceFileName } from "@i18n-doctor/ast";
import type { LiteFileEntry, ProjectSnapshotView } from "@i18n-doctor/scanner";
import type {
  DynamicTranslationUsage,
  TemplateFrameworkId,
  TranslationUsage,
  UntranslatedLiteral,
  UsageWarning,
} from "../api/types.js";
import { analyzeFileAliases } from "./alias-resolve.js";
import { buildFileBindings } from "./bindings.js";
import { collectDynamicUsages } from "./collect-dynamic.js";
import { collectUntranslatedLiterals } from "./collect-untranslated.js";
import { LIBRARY_USAGE_DETECTORS } from "./detectors/index.js";
import { offsetUsages, resolveAbsolutePath } from "./location.js";
import {
  analyzeTemplates,
  extractVueScripts,
  templateSupportedExtension,
} from "./template-scan.js";

function vueFrameworkFromHints(
  hints: ReadonlySet<string>,
): TemplateFrameworkId {
  for (const h of hints) {
    const id = h.toLowerCase();
    if (id === "nuxt-i18n" || id === "@nuxtjs/i18n" || (id.includes("nuxt") && id.includes("i18n"))) {
      return "nuxt";
    }
  }
  return "vue";
}

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

const TEMPLATE_ONLY_EXT = new Set(["html", "htm", "svelte", "astro"]);

export async function collectUsages(input: {
  root: string;
  snapshot: ProjectSnapshotView;
  libraryHints: ReadonlySet<string>;
  minConfidence: number;
  maxFiles: number;
  scanTemplates: boolean;
  warnings: UsageWarning[];
}): Promise<{
  usages: TranslationUsage[];
  dynamicUsages: DynamicTranslationUsage[];
  untranslatedLiterals: UntranslatedLiteral[];
  fileCount: number;
}> {
  const candidates = selectFiles(input.snapshot, input.maxFiles);
  const engine = createAstEngine({ cache: true, concurrency: 4 });
  const usages: TranslationUsage[] = [];
  const dynamicUsages: DynamicTranslationUsage[] = [];
  const untranslatedLiterals: UntranslatedLiteral[] = [];
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
          for (const u of analyzeTemplates({
            absolutePath,
            relativePath,
            sourceText,
            libraryHints: input.libraryHints,
            warnings: input.warnings,
          })) {
            if (u.confidence >= input.minConfidence) {
              usages.push(u);
            }
          }
        }
        const framework = vueFrameworkFromHints(input.libraryHints);
        for (const script of extractVueScripts(sourceText)) {
          const fileName = `${relativePath}.${script.lang}`;
          const { usages: scriptUsages, dynamicUsages: scriptDynamic, untranslatedLiterals: scriptUntranslated } =
            analyzeScript({
              absolutePath,
              relativePath,
              sourceText: script.text,
              fileName,
              engine,
              libraryHints: input.libraryHints,
              minConfidence: input.minConfidence,
            });
          const shifted = offsetUsages(scriptUsages, sourceText, script.offset);
          usages.push(
            ...shifted.map((u) => ({
              ...u,
              framework: u.framework ?? framework,
              detector: u.detector ?? "vue-i18n-detector",
            })),
          );
          dynamicUsages.push(
            ...offsetDynamicUsages(scriptDynamic, sourceText, script.offset),
          );
          untranslatedLiterals.push(
            ...offsetUntranslated(scriptUntranslated, sourceText, script.offset),
          );
        }
        return;
      }

      if (
        TEMPLATE_ONLY_EXT.has(file.extension) &&
        input.scanTemplates &&
        templateSupportedExtension(file.extension)
      ) {
        for (const u of analyzeTemplates({
          absolutePath,
          relativePath,
          sourceText,
          libraryHints: input.libraryHints,
          warnings: input.warnings,
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

      const {
        usages: scriptUsages,
        dynamicUsages: scriptDynamic,
        untranslatedLiterals: scriptUntranslated,
      } = analyzeScript({
          absolutePath,
          relativePath,
          sourceText,
          fileName: relativePath,
          engine,
          libraryHints: input.libraryHints,
          minConfidence: input.minConfidence,
        });
      usages.push(...scriptUsages);
      dynamicUsages.push(...scriptDynamic);
      untranslatedLiterals.push(...scriptUntranslated);
    } catch (error) {
      input.warnings.push({
        code: "analyze-failed",
        message: `Failed analyzing ${file.relativePath}: ${error instanceof Error ? error.message : String(error)}`,
        path: file.relativePath,
      });
    }
  });

  return { usages, dynamicUsages, untranslatedLiterals, fileCount };
}

function analyzeScript(input: {
  absolutePath: string;
  relativePath: string;
  sourceText: string;
  fileName: string;
  engine: ReturnType<typeof createAstEngine>;
  libraryHints: ReadonlySet<string>;
  minConfidence: number;
}): {
  usages: TranslationUsage[];
  dynamicUsages: DynamicTranslationUsage[];
  untranslatedLiterals: UntranslatedLiteral[];
} {
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

  const dynamicUsages = collectDynamicUsages({
    absolutePath: input.absolutePath,
    relativePath: input.relativePath,
    sourceFile: parsed.sourceFile,
    bindings,
    aliasAnalysis,
  });

  const untranslatedLiterals = collectUntranslatedLiterals({
    absolutePath: input.absolutePath,
    relativePath: input.relativePath,
    sourceFile: parsed.sourceFile,
    bindings,
    aliasAnalysis,
    minConfidence: input.minConfidence,
  });

  return { usages: found, dynamicUsages, untranslatedLiterals };
}

function offsetDynamicUsages(
  usages: readonly DynamicTranslationUsage[],
  fullSource: string,
  scriptOffset: number,
): DynamicTranslationUsage[] {
  if (scriptOffset === 0) {
    return [...usages];
  }
  // Reuse TranslationUsage offset helper shape via a thin map.
  const shifted = offsetUsages(
    usages.map((u) => ({
      key: "",
      absolutePath: u.absolutePath,
      relativePath: u.relativePath,
      location: u.location,
      library: u.library,
      confidence: u.confidence,
      context: u.context,
    })),
    fullSource,
    scriptOffset,
  );
  return usages.map((u, i) => ({
    ...u,
    location: shifted[i]!.location,
  }));
}

function offsetUntranslated(
  literals: readonly UntranslatedLiteral[],
  fullSource: string,
  scriptOffset: number,
): UntranslatedLiteral[] {
  if (scriptOffset === 0) {
    return [...literals];
  }
  const shifted = offsetUsages(
    literals.map((u) => ({
      key: u.text,
      absolutePath: u.absolutePath,
      relativePath: u.relativePath,
      location: u.location,
      library: u.library,
      confidence: u.confidence,
      context: "jsx-attribute" as const,
    })),
    fullSource,
    scriptOffset,
  );
  return literals.map((u, i) => ({
    ...u,
    location: shifted[i]!.location,
  }));
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
      TEMPLATE_ONLY_EXT.has(ext)
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
