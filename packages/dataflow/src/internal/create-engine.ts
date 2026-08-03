import path from "node:path";
import { createAstEngine } from "@i18n-unused/ast";
import { createConstantEvaluator } from "@i18n-unused/constants";
import {
  createImportResolver,
  type ImportResolver,
  type ModuleGraph,
} from "@i18n-unused/imports";
import fs from "node:fs";
import ts from "typescript";
import type { DataFlowEngineFactory } from "../api/engine.js";
import type {
  AnalyzeExpressionInput,
  AnalyzeFileInput,
  DataFlowEngine,
  DataFlowEngineOptions,
  DynamicKeyAnalysis,
  PossibleValueSet,
} from "../api/types.js";
import {
  createDynamicEvaluator,
  type EvaluatorHost,
} from "./dynamic-evaluator.js";
import { isTranslationKeyCallee } from "./heuristics.js";
import { relativeToRoot, resolveAgainstRoot } from "./location.js";
import { collectParamFlow } from "./param-flow.js";
import { MutablePropagationGraph } from "./propagation-graph.js";

class DefaultDataFlowEngine implements DataFlowEngine {
  private readonly root: string;
  private readonly maxDepth: number;
  private readonly maxValues: number;
  private readonly readFileFn: (absolutePath: string) => string | undefined;
  private readonly importResolver: ImportResolver;
  private readonly constants;
  private readonly graph = new MutablePropagationGraph();
  private readonly cache = new Map<string, DynamicKeyAnalysis>();
  private readonly paramFlow = new Map<string, PossibleValueSet>();
  private readonly parseCache = new Map<string, ts.SourceFile>();
  private readonly knownFiles = new Map<string, ts.SourceFile>();
  private readonly ast = createAstEngine({
    cache: true,
    cacheSize: 2000,
    setParentNodes: true,
  });
  private moduleGraph: ModuleGraph;
  private readonly host: EvaluatorHost;
  private readonly evaluator;
  private paramFlowDirty = true;

  constructor(options: DataFlowEngineOptions) {
    this.root = path.resolve(options.root);
    this.maxDepth = options.maxDepth ?? 64;
    this.maxValues = options.maxValues ?? 64;
    this.readFileFn =
      options.readFile ??
      ((abs) => {
        try {
          return fs.readFileSync(abs, "utf8");
        } catch {
          return undefined;
        }
      });

    this.importResolver = createImportResolver({
      root: this.root,
      ...(options.aliases !== undefined ? { aliases: options.aliases } : {}),
      ...(options.tsconfigPath !== undefined
        ? { tsconfigPath: options.tsconfigPath }
        : {}),
      ...(options.fileExists !== undefined
        ? { fileExists: options.fileExists }
        : {}),
      ...(options.readFile !== undefined ? { readFile: options.readFile } : {}),
    });
    this.moduleGraph = this.importResolver.buildGraph({ followDepth: 0 });
    this.constants = createConstantEvaluator({
      root: this.root,
      ...(options.aliases !== undefined ? { aliases: options.aliases } : {}),
      ...(options.tsconfigPath !== undefined
        ? { tsconfigPath: options.tsconfigPath }
        : {}),
      ...(options.fileExists !== undefined
        ? { fileExists: options.fileExists }
        : {}),
      ...(options.readFile !== undefined ? { readFile: options.readFile } : {}),
      moduleGraph: this.moduleGraph,
    });

    this.host = {
      root: this.root,
      maxDepth: this.maxDepth,
      maxValues: this.maxValues,
      constants: this.constants,
      importResolver: this.importResolver,
      moduleGraph: this.moduleGraph,
      graph: this.graph,
      readFile: (abs) => this.readFileFn(abs),
      parseFile: (abs) => this.parseFile(abs),
      cache: this.cache,
      paramFlow: this.paramFlow,
    };
    this.evaluator = createDynamicEvaluator(this.host);
  }

  analyzeExpression(input: AnalyzeExpressionInput): DynamicKeyAnalysis {
    const filePath = resolveAgainstRoot(this.root, input.filePath);
    this.ensureFile(filePath, input.sourceFile);
    this.refreshParamFlow();
    return this.evaluator.evaluate(
      filePath,
      input.expression,
      input.sourceFile,
      {
        depth: 0,
        visited: new Set(),
        chain: [],
        paramEnv: input.paramEnv ?? new Map(),
      },
    );
  }

  analyzeFile(input: AnalyzeFileInput): {
    readonly absolutePath: string;
    readonly relativePath: string;
    readonly analyses: readonly DynamicKeyAnalysis[];
  } {
    const absolutePath = resolveAgainstRoot(this.root, input.filePath);
    const sourceFile =
      input.sourceFile ??
      this.parseFile(
        absolutePath,
        input.sourceText ?? this.readFileFn(absolutePath),
      );
    if (!sourceFile) {
      return {
        absolutePath,
        relativePath: relativeToRoot(this.root, absolutePath),
        analyses: [],
      };
    }
    this.ensureFile(absolutePath, sourceFile);
    this.refreshParamFlow();

    const analyses: DynamicKeyAnalysis[] = [];
    const visit = (node: ts.Node): void => {
      // Only translation key call sites (`t`, `i18n.t`, …) — not wrapper args.
      if (ts.isCallExpression(node) && node.arguments.length > 0) {
        const arg = node.arguments[0]!;
        if (
          !ts.isSpreadElement(arg) &&
          ts.isExpression(arg) &&
          isTranslationKeyCallee(node.expression)
        ) {
          const result = this.evaluator.evaluate(
            absolutePath,
            arg,
            sourceFile,
            {
              depth: 0,
              visited: new Set(),
              chain: [],
              paramEnv: new Map(),
            },
          );
          if (result.resolved || result.circular) {
            analyses.push(result);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    analyses.sort(
      (a, b) =>
        (a.sourceLocations[0]?.start ?? 0) -
          (b.sourceLocations[0]?.start ?? 0) ||
        a.possibleKeys.join("\0").localeCompare(b.possibleKeys.join("\0")),
    );

    return {
      absolutePath,
      relativePath: relativeToRoot(this.root, absolutePath),
      analyses,
    };
  }

  getPropagationGraph() {
    return this.graph;
  }

  clearCache(): void {
    this.cache.clear();
    this.parseCache.clear();
    this.knownFiles.clear();
    this.paramFlow.clear();
    this.graph.clear();
    this.constants.clearCache();
    this.importResolver.clearCache();
    this.moduleGraph = this.importResolver.buildGraph({ followDepth: 0 });
    this.host.moduleGraph = this.moduleGraph;
    this.paramFlowDirty = true;
  }

  private ensureFile(
    absolutePath: string,
    sourceFile?: ts.SourceFile,
  ): void {
    if (this.knownFiles.has(absolutePath)) return;
    const sf =
      sourceFile ??
      this.parseFile(absolutePath, this.readFileFn(absolutePath));
    if (!sf) return;
    this.knownFiles.set(absolutePath, sf);
    this.parseCache.set(absolutePath, sf);
    this.moduleGraph.loadModule(absolutePath);
    this.paramFlowDirty = true;
  }

  private refreshParamFlow(): void {
    if (!this.paramFlowDirty) return;
    // Param-flow changes invalidate identifier caches.
    this.cache.clear();
    collectParamFlow(this.host, this.knownFiles);
    this.paramFlowDirty = false;
  }

  private parseFile(
    absolutePath: string,
    sourceText?: string | undefined,
  ): ts.SourceFile | undefined {
    if (sourceText === undefined) {
      const cached = this.parseCache.get(absolutePath);
      if (cached) return cached;
      const text = this.readFileFn(absolutePath);
      if (text === undefined) return undefined;
      return this.parseFile(absolutePath, text);
    }
    const cached = this.parseCache.get(absolutePath);
    if (cached && cached.text === sourceText) return cached;
    const parsed = this.ast.parse({
      fileName: absolutePath,
      sourceText,
    });
    this.parseCache.set(absolutePath, parsed.sourceFile);
    return parsed.sourceFile;
  }
}

export function createDataFlowEngine(
  options: DataFlowEngineOptions,
): DataFlowEngine {
  return new DefaultDataFlowEngine(options);
}

export const dataFlowEngineFactory: DataFlowEngineFactory = {
  createDataFlowEngine,
};
