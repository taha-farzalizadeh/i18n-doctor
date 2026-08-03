import type {
  ConstantEvaluator,
  ConstantEvaluatorOptions,
} from "./types.js";

export interface ConstantEvaluatorFactory {
  createConstantEvaluator(
    options: ConstantEvaluatorOptions,
  ): ConstantEvaluator;
}

export type { ConstantEvaluator, ConstantEvaluatorOptions };
