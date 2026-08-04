/**
 * @i18n-doctor/constants
 *
 * Static constant evaluation for translation keys.
 * Never executes JavaScript — folds literals, concats, templates,
 * object/array access, enums, and imported constants only.
 */

export type {
  Confidence,
  ConstantBinding,
  ConstantDependencyGraph,
  ConstantEvaluator,
  ConstantEvaluatorOptions,
  EvaluateExpressionInput,
  EvaluateIdentifierInput,
  EvaluationContext,
  EvaluationResult,
  EvaluationStep,
  EvaluationStepKind,
  SourceLocation,
  ValueResolver,
} from "./api/types.js";

export type { ConstantEvaluatorFactory } from "./api/evaluator.js";

export {
  createConstantEvaluator,
  constantEvaluatorFactory,
} from "./internal/create-evaluator.js";
