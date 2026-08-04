import path from "node:path";
import { createAstEngine } from "@i18n-doctor/ast";
import {
  createImportResolver,
  type ImportResolver,
  type ModuleGraph,
} from "@i18n-doctor/imports";
import fs from "node:fs";
import ts from "typescript";
import type { ConstantEvaluatorFactory } from "../api/evaluator.js";
import type {
  ConstantDependencyGraph,
  ConstantEvaluator,
  ConstantEvaluatorOptions,
  EvaluateExpressionInput,
  EvaluateIdentifierInput,
  EvaluationResult,
} from "../api/types.js";
import { MutableConstantGraph } from "./dependency-graph.js";
import { locationOf, resolveAgainstRoot } from "./location.js";
import { createValueResolver, type ValueResolverHost } from "./value-resolver.js";

class DefaultConstantEvaluator implements ConstantEvaluator {
  private readonly root: string;
  private readonly maxDepth: number;
  private readonly dependencyGraph = new MutableConstantGraph();
  private readonly cache = new Map<string, EvaluationResult>();
  private readonly ast = createAstEngine({
    cache: true,
    cacheSize: 2000,
    setParentNodes: true,
  });
  private readonly parseCache = new Map<string, ts.SourceFile>();
  private readonly importResolver: ImportResolver;
  private readonly readFileFn: (absolutePath: string) => string | undefined;
  private readonly host: ValueResolverHost;
  private readonly valueResolver;

  constructor(options: ConstantEvaluatorOptions) {
    this.root = path.resolve(options.root);
    this.maxDepth = options.maxDepth ?? 256;
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

    const moduleGraph: ModuleGraph =
      options.moduleGraph ??
      this.importResolver.buildGraph({ followDepth: 0 });

    this.host = {
      root: this.root,
      maxDepth: this.maxDepth,
      graph: this.dependencyGraph,
      importResolver: this.importResolver,
      moduleGraph,
      readFile: (abs) => this.readFileFn(abs),
      parseFile: (abs) => this.parseFile(abs),
      cache: this.cache,
    };
    this.valueResolver = createValueResolver(this.host);
  }

  evaluateExpression(input: EvaluateExpressionInput): EvaluationResult {
    const filePath = resolveAgainstRoot(this.root, input.filePath);
    this.ensureModule(filePath);
    const result = this.valueResolver.resolve(
      filePath,
      input.expression,
      input.sourceFile,
      { depth: 0, visited: new Set(), chain: [] },
    );
    // Public location is always the evaluated expression (use site).
    return withLocation(
      result,
      locationOf(input.sourceFile, input.expression),
    );
  }

  evaluateIdentifier(input: EvaluateIdentifierInput): EvaluationResult {
    const filePath = resolveAgainstRoot(this.root, input.filePath);
    this.ensureModule(filePath);
    const position = input.position ?? input.sourceFile.end;
    const ident =
      findIdentifierNode(input.sourceFile, input.name, position) ??
      ts.factory.createIdentifier(input.name);
    const result = this.valueResolver.resolve(
      filePath,
      ident,
      input.sourceFile,
      { depth: 0, visited: new Set(), chain: [] },
    );
    const loc =
      ident.pos >= 0 && ident.end >= 0
        ? locationOf(input.sourceFile, ident)
        : result.sourceLocation;
    return withLocation(result, loc);
  }

  getDependencyGraph(): ConstantDependencyGraph {
    return this.dependencyGraph;
  }

  clearCache(): void {
    this.cache.clear();
    this.parseCache.clear();
    this.dependencyGraph.clear();
    this.importResolver.clearCache();
    this.host.moduleGraph = this.importResolver.buildGraph({ followDepth: 0 });
  }

  private ensureModule(absolutePath: string): void {
    this.host.moduleGraph.loadModule(absolutePath);
  }

  private parseFile(absolutePath: string): ts.SourceFile | undefined {
    const cached = this.parseCache.get(absolutePath);
    if (cached) return cached;
    const text = this.readFileFn(absolutePath);
    if (text === undefined) return undefined;
    const parsed = this.ast.parse({
      fileName: absolutePath,
      sourceText: text,
    });
    this.parseCache.set(absolutePath, parsed.sourceFile);
    return parsed.sourceFile;
  }
}

function findIdentifierNode(
  sourceFile: ts.SourceFile,
  name: string,
  position: number,
): ts.Identifier | undefined {
  let best: ts.Identifier | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === name) {
      const start = node.getStart(sourceFile);
      if (start <= position) {
        if (!best || start >= best.getStart(sourceFile)) {
          best = node;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return best;
}

function withLocation(
  result: EvaluationResult,
  sourceLocation: EvaluationResult["sourceLocation"],
): EvaluationResult {
  if (
    result.sourceLocation.start === sourceLocation.start &&
    result.sourceLocation.end === sourceLocation.end
  ) {
    return result;
  }
  return { ...result, sourceLocation };
}

export function createConstantEvaluator(
  options: ConstantEvaluatorOptions,
): ConstantEvaluator {
  return new DefaultConstantEvaluator(options);
}

export const constantEvaluatorFactory: ConstantEvaluatorFactory = {
  createConstantEvaluator,
};
