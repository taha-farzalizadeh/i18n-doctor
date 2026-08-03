import type { CallGraphAnalyzer, CallGraphAnalyzerOptions } from "./types.js";

export interface CallGraphAnalyzerFactory {
  createCallGraphAnalyzer(options: CallGraphAnalyzerOptions): CallGraphAnalyzer;
}

export type { CallGraphAnalyzer, CallGraphAnalyzerOptions };
