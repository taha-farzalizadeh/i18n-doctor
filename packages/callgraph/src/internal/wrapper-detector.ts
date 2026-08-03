import type {
  CallGraph,
  FunctionGraph,
  TranslationSeed,
  WrapperInfo,
} from "../api/types.js";
import {
  propagateTranslationFunctions,
  type PropagationResult,
} from "./propagation.js";

export interface WrapperDetectorOptions {
  readonly functionGraph: FunctionGraph;
  readonly callGraph: CallGraph;
  readonly seeds: readonly TranslationSeed[];
  readonly maxDepth?: number;
}

/**
 * Wrapper Detector — runs the Translation Function Propagation Engine
 * over a FunctionGraph + CallGraph and returns detected wrappers.
 */
export class WrapperDetector {
  private readonly options: WrapperDetectorOptions;
  private result: PropagationResult;

  constructor(options: WrapperDetectorOptions) {
    this.options = options;
    this.result = this.run();
  }

  detect(): readonly WrapperInfo[] {
    this.result = this.run();
    return this.result.wrappers;
  }

  getPropagation(): PropagationResult {
    return this.result;
  }

  private run(): PropagationResult {
    return propagateTranslationFunctions({
      functionGraph: this.options.functionGraph,
      callGraph: this.options.callGraph,
      seeds: this.options.seeds,
      maxDepth: this.options.maxDepth ?? 64,
    });
  }
}

export function createWrapperDetector(
  options: WrapperDetectorOptions,
): WrapperDetector {
  return new WrapperDetector(options);
}
