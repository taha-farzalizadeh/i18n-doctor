/**
 * @i18n-doctor/callgraph
 *
 * Call graph construction and translation wrapper detection.
 * Never executes JavaScript. I18n seeds are injectable and kept separate
 * from graph construction.
 */

export type {
  AnalyzeFileInput,
  CallEdge,
  CallEdgeKind,
  CallGraph,
  CallGraphAnalyzer,
  CallGraphAnalyzerOptions,
  Confidence,
  FileCallAnalysis,
  FunctionGraph,
  FunctionId,
  FunctionKind,
  FunctionNode,
  ProjectCallAnalysis,
  PropagationRecord,
  ResolvedTranslationCall,
  SourceLocation,
  TranslationSeed,
  WrapperInfo,
} from "./api/types.js";

export type { CallGraphAnalyzerFactory } from "./api/analyzer.js";

export {
  createCallGraphAnalyzer,
  callGraphAnalyzerFactory,
} from "./internal/create-analyzer.js";

export {
  createWrapperDetector,
  WrapperDetector,
} from "./internal/wrapper-detector.js";
export type { WrapperDetectorOptions } from "./internal/wrapper-detector.js";

export { propagateTranslationFunctions } from "./internal/propagation.js";
export { extractFileGraph } from "./internal/ast-extract.js";
export { MutableFunctionGraph } from "./internal/function-graph.js";
export { MutableCallGraph } from "./internal/call-graph.js";
export { DEFAULT_TRANSLATION_SEEDS } from "./internal/i18n-seeds.js";
