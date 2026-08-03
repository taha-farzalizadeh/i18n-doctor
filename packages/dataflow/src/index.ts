/**
 * @i18n-unused/dataflow
 *
 * Dynamic key analysis and basic data-flow.
 * Never executes JavaScript. Prefers multiple possible keys over
 * incorrect certainty.
 */

export type {
  AnalysisType,
  AnalyzeExpressionInput,
  AnalyzeFileInput,
  Confidence,
  DataFlowEngine,
  DataFlowEngineOptions,
  DynamicExpressionEvaluator,
  DynamicKeyAnalysis,
  EvaluationContext,
  PossibleValueSet,
  PropagationNode,
  ResolutionStep,
  ResolutionStepKind,
  SourceLocation,
  ValuePropagationGraph,
} from "./api/types.js";

export type { DataFlowEngineFactory } from "./api/engine.js";

export {
  createDataFlowEngine,
  dataFlowEngineFactory,
} from "./internal/create-engine.js";

export {
  createDynamicEvaluator,
} from "./internal/dynamic-evaluator.js";

export {
  emptySet,
  singleton,
  fromValues,
  unionSets,
  concatSets,
} from "./internal/possible-set.js";

export { MutablePropagationGraph } from "./internal/propagation-graph.js";
