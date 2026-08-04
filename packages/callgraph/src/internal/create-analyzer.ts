import path from "node:path";
import { createAstEngine } from "@i18n-doctor/ast";
import { createConstantEvaluator } from "@i18n-doctor/constants";
import {
  createImportResolver,
  type ImportResolver,
  type ModuleGraph,
} from "@i18n-doctor/imports";
import fs from "node:fs";
import ts from "typescript";
import type { CallGraphAnalyzerFactory } from "../api/analyzer.js";
import type {
  CallGraphAnalyzer,
  CallGraphAnalyzerOptions,
  AnalyzeFileInput,
  FileCallAnalysis,
  ProjectCallAnalysis,
  WrapperInfo,
} from "../api/types.js";
import { extractFileGraph } from "./ast-extract.js";
import { MutableCallGraph } from "./call-graph.js";
import { MutableFunctionGraph } from "./function-graph.js";
import { DEFAULT_TRANSLATION_SEEDS } from "./i18n-seeds.js";
import { relativeToRoot, resolveAgainstRoot } from "./location.js";
import { propagateTranslationFunctions } from "./propagation.js";
import { resolveTranslationCallsInFile } from "./resolve-calls.js";
import { ScopeMetaStore } from "./scope-meta.js";

class DefaultCallGraphAnalyzer implements CallGraphAnalyzer {
  private readonly root: string;
  private readonly maxDepth: number;
  private readonly seeds;
  private readonly readFileFn: (absolutePath: string) => string | undefined;
  private readonly options: CallGraphAnalyzerOptions;
  private readonly importResolver: ImportResolver;
  private moduleGraph: ModuleGraph;
  private readonly evaluator;

  private readonly functionGraph = new MutableFunctionGraph();
  private readonly callGraph = new MutableCallGraph();
  private readonly scopes = new ScopeMetaStore();
  private readonly ast = createAstEngine({
    cache: true,
    cacheSize: 2000,
    setParentNodes: true,
  });
  private readonly parseCache = new Map<string, ts.SourceFile>();
  private readonly fileCache = new Map<string, FileCallAnalysis>();
  private readonly loadedFiles = new Set<string>();
  private graphDirty = true;

  private wrappers: WrapperInfo[] = [];
  private propagation = propagateTranslationFunctions({
    functionGraph: this.functionGraph,
    callGraph: this.callGraph,
    seeds: DEFAULT_TRANSLATION_SEEDS,
    maxDepth: 64,
  });

  constructor(options: CallGraphAnalyzerOptions) {
    this.root = path.resolve(options.root);
    this.maxDepth = options.maxDepth ?? 64;
    this.seeds = options.seeds ?? DEFAULT_TRANSLATION_SEEDS;
    this.options = options;
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
    this.evaluator = createConstantEvaluator({
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
    this.functionGraph.attachScopes(this.scopes);
    this.repropagate();
  }

  analyzeFile(input: AnalyzeFileInput): FileCallAnalysis {
    const absolutePath = resolveAgainstRoot(this.root, input.filePath);
    this.ensureFileLoaded(absolutePath, input);
    this.repropagateIfDirty();
    return this.buildFileAnalysis(absolutePath);
  }

  analyzeFiles(filePaths: readonly string[]): ProjectCallAnalysis {
    const sorted = [...filePaths].sort((a, b) =>
      resolveAgainstRoot(this.root, a).localeCompare(
        resolveAgainstRoot(this.root, b),
      ),
    );
    for (const fp of sorted) {
      this.ensureFileLoaded(resolveAgainstRoot(this.root, fp), {
        filePath: fp,
      });
    }
    this.repropagateIfDirty();
    this.fileCache.clear();
    const files = sorted.map((fp) =>
      this.buildFileAnalysis(resolveAgainstRoot(this.root, fp)),
    );
    const translationCalls = files.flatMap((f) => f.translationCalls);
    translationCalls.sort(
      (a, b) =>
        a.absolutePath.localeCompare(b.absolutePath) ||
        a.location.start - b.location.start,
    );
    return {
      root: this.root,
      files,
      functionGraph: this.functionGraph,
      callGraph: this.callGraph,
      wrappers: this.wrappers,
      translationCalls,
    };
  }

  getFunctionGraph() {
    return this.functionGraph;
  }

  getCallGraph() {
    return this.callGraph;
  }

  getWrappers() {
    return this.wrappers;
  }

  clearCache(): void {
    this.fileCache.clear();
    this.parseCache.clear();
    this.loadedFiles.clear();
    this.functionGraph.clear();
    this.callGraph.clear();
    this.scopes.clear();
    this.wrappers = [];
    this.importResolver.clearCache();
    this.evaluator.clearCache();
    this.moduleGraph = this.importResolver.buildGraph({ followDepth: 0 });
    this.functionGraph.attachScopes(this.scopes);
    this.graphDirty = true;
    this.repropagateIfDirty();
  }

  private ensureFileLoaded(
    absolutePath: string,
    input: AnalyzeFileInput,
  ): void {
    if (this.loadedFiles.has(absolutePath)) return;

    const sourceFile =
      input.sourceFile ??
      this.parseFile(
        absolutePath,
        input.sourceText ?? this.readFileFn(absolutePath),
      );
    if (!sourceFile) {
      this.loadedFiles.add(absolutePath);
      return;
    }

    this.parseCache.set(absolutePath, sourceFile);
    const extracted = extractFileGraph({
      root: this.root,
      absolutePath,
      sourceFile,
    });
    for (const fn of extracted.functions) {
      this.functionGraph.set(fn);
    }
    for (const edge of extracted.edges) {
      this.callGraph.add(edge);
    }
    this.scopes.mergeFrom(extracted.scopes);

    this.loadedFiles.add(absolutePath);
    this.moduleGraph.loadModule(absolutePath);
    this.fileCache.clear();
    this.graphDirty = true;
  }

  private buildFileAnalysis(absolutePath: string): FileCallAnalysis {
    const cached = this.fileCache.get(absolutePath);
    if (cached) return cached;

    const sourceFile = this.parseCache.get(absolutePath);
    const relativePath = relativeToRoot(this.root, absolutePath);
    if (!sourceFile) {
      const empty: FileCallAnalysis = {
        absolutePath,
        relativePath,
        functions: [],
        edges: [],
        wrappers: [],
        translationCalls: [],
      };
      this.fileCache.set(absolutePath, empty);
      return empty;
    }

    const functions = this.functionGraph
      .inFile(absolutePath)
      .filter((f) => !f.synthetic);
    const edges = this.callGraph.edges.filter(
      (e) => e.absolutePath === absolutePath,
    );
    const wrappers = this.wrappers.filter(
      (w) => w.absolutePath === absolutePath,
    );
    const translationCalls = resolveTranslationCallsInFile({
      root: this.root,
      absolutePath,
      sourceFile,
      functionGraph: this.functionGraph,
      records: this.propagation.records,
      aliasRecords: this.propagation.aliasRecords,
      scopes: this.scopes,
      evaluator: this.evaluator,
      importResolver: this.importResolver,
      moduleGraph: this.moduleGraph,
    });

    const analysis: FileCallAnalysis = {
      absolutePath,
      relativePath,
      functions,
      edges,
      wrappers,
      translationCalls,
    };
    this.fileCache.set(absolutePath, analysis);
    return analysis;
  }

  private repropagateIfDirty(): void {
    if (!this.graphDirty) return;
    this.repropagate();
    this.graphDirty = false;
  }

  private repropagate(): void {
    this.propagation = propagateTranslationFunctions({
      functionGraph: this.functionGraph,
      callGraph: this.callGraph,
      seeds: this.seeds,
      maxDepth: this.maxDepth,
      scopes: this.scopes,
    });
    for (const seed of this.propagation.seedNodes) {
      this.functionGraph.set(seed);
    }
    this.wrappers = [...this.propagation.wrappers];
  }

  private parseFile(
    absolutePath: string,
    sourceText: string | undefined,
  ): ts.SourceFile | undefined {
    if (sourceText === undefined) return undefined;
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

export function createCallGraphAnalyzer(
  options: CallGraphAnalyzerOptions,
): CallGraphAnalyzer {
  return new DefaultCallGraphAnalyzer(options);
}

export const callGraphAnalyzerFactory: CallGraphAnalyzerFactory = {
  createCallGraphAnalyzer,
};
