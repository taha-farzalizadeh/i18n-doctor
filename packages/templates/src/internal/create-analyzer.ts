import type {
  TemplateAnalysisInput,
  TemplateAnalysisResult,
  TemplateAnalyzer,
  TemplateAnalyzerOptions,
  TemplateParser,
  TemplateUsage,
  TemplateWarning,
} from "../api/types.js";
import { createAngularTemplateParser } from "./parsers/angular.js";
import { createAstroTemplateParser } from "./parsers/astro.js";
import { createNuxtTemplateParser } from "./parsers/nuxt.js";
import { createSvelteTemplateParser } from "./parsers/svelte.js";
import { createVueTemplateParser } from "./parsers/vue.js";

/** Soft cap for direct analyzer API (usages package also enforces its own limit). */
const MAX_TEMPLATE_CHARS = 1_500_000;

export function createDefaultParsers(): TemplateParser[] {
  return [
    createNuxtTemplateParser(),
    createVueTemplateParser({ rejectNuxt: true }),
    createAngularTemplateParser(),
    createSvelteTemplateParser(),
    createAstroTemplateParser(),
  ];
}

export function createTemplateAnalyzer(
  options: TemplateAnalyzerOptions = {},
): TemplateAnalyzer {
  const disabled = new Set(options.disable ?? []);
  const parsers = [
    ...createDefaultParsers().filter((p) => !disabled.has(p.id)),
    ...(options.parsers ?? []),
  ];

  const byExt = new Map<string, TemplateParser[]>();
  for (const parser of parsers) {
    for (const ext of parser.extensions) {
      const key = ext.toLowerCase();
      const list = byExt.get(key) ?? [];
      list.push(parser);
      byExt.set(key, list);
    }
  }

  return {
    parsers,
    supportsExtension(extension: string): boolean {
      return byExt.has(extension.replace(/^\./, "").toLowerCase());
    },
    supportedExtensions(): readonly string[] {
      return [...byExt.keys()].sort();
    },
    analyzeFile(input: TemplateAnalysisInput): TemplateAnalysisResult {
      if (input.sourceText.length > MAX_TEMPLATE_CHARS) {
        return {
          usages: [],
          warnings: [
            {
              code: "file-too-large",
              message: `Skipping ${input.relativePath}: exceeds template size limit`,
              path: input.relativePath,
            },
          ],
        };
      }

      const ext = extensionOf(input.relativePath);
      if (!ext) {
        return { usages: [], warnings: [] };
      }
      const candidates = byExt.get(ext) ?? [];
      if (candidates.length === 0) {
        return { usages: [], warnings: [] };
      }

      const usages: TemplateUsage[] = [];
      const warnings: TemplateWarning[] = [];
      const seen = new Set<string>();

      for (const parser of candidates) {
        let result: TemplateAnalysisResult;
        try {
          result = parser.analyze(input);
        } catch (error) {
          warnings.push({
            code: "template-parse-failed",
            message: `${parser.id} failed on ${input.relativePath}: ${error instanceof Error ? error.message : String(error)}`,
            path: input.relativePath,
          });
          continue;
        }
        warnings.push(...result.warnings);
        for (const usage of result.usages) {
          const dedupe = `${usage.location.start}:${usage.location.end}:${usage.key}:${usage.detector}`;
          if (seen.has(dedupe)) {
            continue;
          }
          seen.add(dedupe);
          usages.push(usage);
        }
      }

      usages.sort(
        (a, b) =>
          a.location.start - b.location.start ||
          a.location.end - b.location.end ||
          a.key.localeCompare(b.key) ||
          a.detector.localeCompare(b.detector),
      );

      return { usages, warnings };
    },
  };
}

function extensionOf(relativePath: string): string | undefined {
  const base = relativePath.split(/[\\/]/).pop() ?? relativePath;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) {
    return undefined;
  }
  return base.slice(dot + 1).toLowerCase();
}
