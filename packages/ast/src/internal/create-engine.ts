import ts from "typescript";
import type { AstEngine, AstEngineFactory } from "../api/engine.js";
import type {
  AstDiagnostic,
  AstEngineOptions,
  ParseBatchResult,
  ParsedFile,
  ParseInput,
} from "../api/types.js";
import { buildContentKey, ParseCache } from "./cache.js";
import { engineDiagnostic } from "./diagnostics.js";
import { parseSourceFile } from "./parse-file.js";
import { mapPool } from "./pool.js";

const DEFAULTS: Required<AstEngineOptions> = {
  target: ts.ScriptTarget.Latest,
  concurrency: 4,
  cache: true,
  cacheSize: 2000,
  setParentNodes: true,
  retainSourceText: true,
};

class TypeScriptAstEngine implements AstEngine {
  readonly options: Readonly<Required<AstEngineOptions>>;
  private readonly cache: ParseCache | undefined;

  constructor(options: AstEngineOptions = {}) {
    this.options = {
      target: options.target ?? DEFAULTS.target,
      concurrency: Math.max(1, options.concurrency ?? DEFAULTS.concurrency),
      cache: options.cache ?? DEFAULTS.cache,
      cacheSize: Math.max(0, options.cacheSize ?? DEFAULTS.cacheSize),
      setParentNodes: options.setParentNodes ?? DEFAULTS.setParentNodes,
      retainSourceText: options.retainSourceText ?? DEFAULTS.retainSourceText,
    };
    this.cache = this.options.cache
      ? new ParseCache(this.options.cacheSize)
      : undefined;
  }

  parse(input: ParseInput): ParsedFile {
    const parseOptions = {
      target: this.options.target,
      setParentNodes: this.options.setParentNodes,
      retainSourceText: this.options.retainSourceText,
    };

    // Non-string source is an engine error — do not coerce to empty success.
    if (typeof input.sourceText !== "string") {
      return parseSourceFile(input, parseOptions, false);
    }

    const fileId = input.fileId ?? input.fileName;
    const contentKey = buildContentKey(
      fileId,
      input.fileName,
      input.sourceText,
      input.contentHash,
      input.mtimeMs,
    );

    if (this.cache) {
      const hit = this.cache.get(contentKey);
      if (hit) {
        return {
          fileId: hit.fileId,
          fileName: hit.fileName,
          language: hit.language,
          jsx: hit.jsx,
          scriptKind: hit.scriptKind,
          sourceText: hit.sourceText,
          sourceFile: hit.sourceFile,
          diagnostics: hit.diagnostics,
          ok: hit.ok,
          contentKey: hit.contentKey,
          parsedAt: hit.parsedAt,
          fromCache: true,
        };
      }
    }

    const parsed = parseSourceFile(input, parseOptions, false);
    this.cache?.set(contentKey, parsed);
    return parsed;
  }

  async parseMany(inputs: readonly ParseInput[]): Promise<ParseBatchResult> {
    const started = performance.now();
    const engineErrors: AstDiagnostic[] = [];
    // Per-task timings avoid shared mutable counters under concurrency.
    const parseDurations: number[] = new Array(inputs.length).fill(0);
    const cacheFlags: boolean[] = new Array(inputs.length).fill(false);

    const files = await mapPool(
      inputs,
      this.options.concurrency,
      (input, index) => {
        const parseStarted = performance.now();
        try {
          const parsed = this.parse(input);
          cacheFlags[index] = parsed.fromCache;
          parseDurations[index] = performance.now() - parseStarted;
          return parsed;
        } catch (error) {
          cacheFlags[index] = false;
          parseDurations[index] = performance.now() - parseStarted;
          const fileId = input.fileId ?? input.fileName;
          const message =
            error instanceof Error ? error.message : String(error);
          const diagnostic = engineDiagnostic(
            fileId,
            input.fileName,
            `AST engine failed to parse '${input.fileName}': ${message}`,
          );
          engineErrors.push(diagnostic);

          const stub = parseSourceFile(
            { ...input, sourceText: "" },
            {
              target: this.options.target,
              setParentNodes: this.options.setParentNodes,
              retainSourceText: this.options.retainSourceText,
            },
            false,
          );

          return {
            ...stub,
            ok: false,
            diagnostics: [...stub.diagnostics, diagnostic],
          };
        }
      },
    );

    let cacheHits = 0;
    let parseMs = 0;
    for (let i = 0; i < inputs.length; i += 1) {
      parseMs += parseDurations[i] ?? 0;
      if (cacheFlags[i]) {
        cacheHits += 1;
      }
    }

    return {
      files,
      engineErrors,
      timings: {
        totalMs: performance.now() - started,
        parseMs,
        cacheHits,
        cacheMisses: inputs.length - cacheHits,
      },
    };
  }

  invalidate(fileId: string): void {
    this.cache?.invalidateFile(fileId);
  }

  clearCache(): void {
    this.cache?.clear();
  }
}

export function createAstEngine(options?: AstEngineOptions): AstEngine {
  return new TypeScriptAstEngine(options);
}

export const astEngineFactory: AstEngineFactory = {
  createAstEngine,
};
