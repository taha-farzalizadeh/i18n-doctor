import type { ContextAnalyzer, ContextAnalyzerOptions } from "./types.js";

export interface ContextAnalyzerFactory {
  createContextAnalyzer(options: ContextAnalyzerOptions): ContextAnalyzer;
}

export type { ContextAnalyzer, ContextAnalyzerOptions };
