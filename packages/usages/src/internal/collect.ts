import { createAstEngine, isSupportedSourceFileName } from "@i18n-doctor/ast";
import type { LiteFileEntry, ProjectSnapshotView } from "@i18n-doctor/scanner";
import ts from "typescript";
import type {
  DynamicTranslationUsage,
  TemplateFrameworkId,
  TranslationUsage,
  UntranslatedLiteral,
  UsageWarning,
} from "../api/types.js";
import { analyzeFileAliases } from "./alias-resolve.js";
import {
  buildFileBindings,
  enrichBindingsFromCallSites,
} from "./bindings.js";
import { collectDynamicUsages } from "./collect-dynamic.js";
import { collectMappedPropUsages } from "./collect-mapped-prop-keys.js";
import { collectUntranslatedLiterals } from "./collect-untranslated.js";
import { LIBRARY_USAGE_DETECTORS } from "./detectors/index.js";
import { offsetUsages, resolveAbsolutePath } from "./location.js";
import {
  indexObjectArrayProps,
  type ObjectArrayPropIndex,
} from "./object-array-props.js";
import {
  indexStringEnums,
  mergeEnumValueIndex,
  type EnumValueIndex,
} from "./enum-values.js";
import {
  indexHelperStringReturns,
  mergeHelperReturnIndex,
  type HelperReturnIndex,
} from "./helper-returns.js";
import {
  analyzeTemplates,
  extractVueScripts,
  templateSupportedExtension,
} from "./template-scan.js";
import { setModuleResolveRoot } from "./module-path.js";
import {
  collectTranslatorCallSiteNamespaces,
  indexStoreSelectorAliases,
  indexTranslatorCallables,
  mergeStoreSelectorAliases,
  mergeTranslatorCallSiteNamespaces,
  propagateNestedTranslatorCallSites,
  type StoreSelectorAliasIndex,
  type TranslatorCallSiteNamespaces,
  type TranslatorCallableIndex,
} from "./translator-call-flow.js";

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
  setModuleResolveRoot(input.root);

  // Pre-index string enums, then object-array configs + translator callables + helpers.
  const enumIndex: EnumValueIndex = new Map();
  const objectArrayIndex: ObjectArrayPropIndex = new Map();
  const helperReturnIndex: HelperReturnIndex = new Map();
  const translatorCallableIndex: TranslatorCallableIndex = new Map();
  const storeSelectorAliases: StoreSelectorAliasIndex = new Map();
  await mapPool(candidates, ANALYZE_CONCURRENCY, async (file) => {
    try {
      const read = await input.snapshot.content.read(file.fileId);
      if (!read.ok || read.bytes.byteLength > MAX_FILE_BYTES) return;
      const sourceText = Buffer.from(read.bytes).toString("utf8");
      if (file.extension === "vue") {
        for (const script of extractVueScripts(sourceText)) {
          const parsed = engine.parse({
            fileName: `${file.relativePath}.${script.lang}`,
            sourceText: script.text,
          });
          mergeEnumValueIndex(
            enumIndex,
            indexStringEnums(parsed.sourceFile, file.relativePath),
          );
        }
        return;
      }
      if (!SCRIPT_EXT.has(file.extension)) return;
      if (!isSupportedSourceFileName(file.relativePath)) return;
      const parsed = engine.parse({
        fileName: file.relativePath,
        sourceText,
      });
      mergeEnumValueIndex(
        enumIndex,
        indexStringEnums(parsed.sourceFile, file.relativePath),
      );
    } catch {
      // Best-effort.
    }
  });

  await mapPool(candidates, ANALYZE_CONCURRENCY, async (file) => {
    try {
      const read = await input.snapshot.content.read(file.fileId);
      if (!read.ok || read.bytes.byteLength > MAX_FILE_BYTES) return;
      const sourceText = Buffer.from(read.bytes).toString("utf8");
      if (file.extension === "vue") {
        for (const script of extractVueScripts(sourceText)) {
          const fileName = `${file.relativePath}.${script.lang}`;
          const parsed = engine.parse({
            fileName,
            sourceText: script.text,
          });
          mergeObjectArrayIndex(
            objectArrayIndex,
            indexObjectArrayProps(
              parsed.sourceFile,
              file.relativePath,
              enumIndex,
            ),
          );
          mergeHelperReturnIndex(
            helperReturnIndex,
            indexHelperStringReturns(parsed.sourceFile, file.relativePath),
          );
          mergeTranslatorCallableIndex(
            translatorCallableIndex,
            indexTranslatorCallables(parsed.sourceFile, file.relativePath),
          );
          mergeStoreSelectorAliases(
            storeSelectorAliases,
            indexStoreSelectorAliases(parsed.sourceFile),
          );
        }
        return;
      }
      if (!SCRIPT_EXT.has(file.extension)) return;
      if (!isSupportedSourceFileName(file.relativePath)) return;
      const parsed = engine.parse({
        fileName: file.relativePath,
        sourceText,
      });
      mergeObjectArrayIndex(
        objectArrayIndex,
        indexObjectArrayProps(parsed.sourceFile, file.relativePath, enumIndex),
      );
      mergeHelperReturnIndex(
        helperReturnIndex,
        indexHelperStringReturns(parsed.sourceFile, file.relativePath),
      );
      mergeTranslatorCallableIndex(
        translatorCallableIndex,
        indexTranslatorCallables(parsed.sourceFile, file.relativePath),
      );
      mergeStoreSelectorAliases(
        storeSelectorAliases,
        indexStoreSelectorAliases(parsed.sourceFile),
      );
    } catch {
      // Best-effort index; analysis below still runs.
    }
  });

  // Collect namespaces passed into those callables (usersColumns(t), …).
  const translatorCallSites: TranslatorCallSiteNamespaces = new Map();
  if (translatorCallableIndex.size > 0) {
    await mapPool(candidates, ANALYZE_CONCURRENCY, async (file) => {
      try {
        if (
          !SCRIPT_EXT.has(file.extension) &&
          file.extension !== "vue"
        ) {
          return;
        }
        const read = await input.snapshot.content.read(file.fileId);
        if (!read.ok || read.bytes.byteLength > MAX_FILE_BYTES) return;
        const sourceText = Buffer.from(read.bytes).toString("utf8");
        const ingest = (sourceFile: ts.SourceFile, relativePath: string) => {
          const bindings = buildFileBindings(sourceFile);
          mergeTranslatorCallSiteNamespaces(
            translatorCallSites,
            collectTranslatorCallSiteNamespaces(
              sourceFile,
              relativePath,
              bindings,
              translatorCallableIndex,
              storeSelectorAliases,
            ),
          );
        };
        if (file.extension === "vue") {
          for (const script of extractVueScripts(sourceText)) {
            const parsed = engine.parse({
              fileName: `${file.relativePath}.${script.lang}`,
              sourceText: script.text,
            });
            ingest(parsed.sourceFile, file.relativePath);
          }
          return;
        }
        if (!isSupportedSourceFileName(file.relativePath)) return;
        const parsed = engine.parse({
          fileName: file.relativePath,
          sourceText,
        });
        ingest(parsed.sourceFile, file.relativePath);
      } catch {
        // Best-effort.
      }
    });

    // Propagate schema(t) → dateSchema(t) nested factories in the same file.
    await mapPool(candidates, ANALYZE_CONCURRENCY, async (file) => {
      try {
        if (!SCRIPT_EXT.has(file.extension) && file.extension !== "vue") {
          return;
        }
        const read = await input.snapshot.content.read(file.fileId);
        if (!read.ok || read.bytes.byteLength > MAX_FILE_BYTES) return;
        const sourceText = Buffer.from(read.bytes).toString("utf8");
        const propagate = (sourceFile: ts.SourceFile, relativePath: string) => {
          propagateNestedTranslatorCallSites(
            sourceFile,
            relativePath,
            translatorCallableIndex,
            translatorCallSites,
          );
        };
        if (file.extension === "vue") {
          for (const script of extractVueScripts(sourceText)) {
            const parsed = engine.parse({
              fileName: `${file.relativePath}.${script.lang}`,
              sourceText: script.text,
            });
            propagate(parsed.sourceFile, file.relativePath);
          }
          return;
        }
        if (!isSupportedSourceFileName(file.relativePath)) return;
        const parsed = engine.parse({
          fileName: file.relativePath,
          sourceText,
        });
        propagate(parsed.sourceFile, file.relativePath);
      } catch {
        // Best-effort.
      }
    });
  }

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
              objectArrayIndex,
              enumIndex,
              helperReturnIndex,
              translatorCallSites,
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
          objectArrayIndex,
          enumIndex,
          helperReturnIndex,
          translatorCallSites,
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

function mergeObjectArrayIndex(
  target: ObjectArrayPropIndex,
  source: ObjectArrayPropIndex,
): void {
  for (const [key, props] of source) {
    target.set(key, props);
  }
}

function mergeTranslatorCallableIndex(
  target: TranslatorCallableIndex,
  source: TranslatorCallableIndex,
): void {
  for (const [key, info] of source) {
    target.set(key, info);
  }
}

function analyzeScript(input: {
  absolutePath: string;
  relativePath: string;
  sourceText: string;
  fileName: string;
  engine: ReturnType<typeof createAstEngine>;
  libraryHints: ReadonlySet<string>;
  minConfidence: number;
  objectArrayIndex: ObjectArrayPropIndex;
  enumIndex: EnumValueIndex;
  helperReturnIndex: HelperReturnIndex;
  translatorCallSites: TranslatorCallSiteNamespaces;
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
  enrichBindingsFromCallSites(
    bindings,
    parsed.sourceFile,
    input.relativePath,
    input.translatorCallSites,
  );
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

  for (const usage of collectMappedPropUsages({
    absolutePath: input.absolutePath,
    relativePath: input.relativePath,
    sourceFile: parsed.sourceFile,
    bindings,
    aliasAnalysis,
    index: input.objectArrayIndex,
    enumIndex: input.enumIndex,
    helperIndex: input.helperReturnIndex,
  })) {
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
