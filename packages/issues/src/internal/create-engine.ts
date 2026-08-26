import type { IssueEngineFactory } from "../api/engine.js";
import type {
  AnalysisResult,
  AnalyzeInput,
  IssueEngine,
  IssueEngineOptions,
} from "../api/types.js";
import { analyzeIssues } from "./analyze.js";

class DefaultIssueEngine implements IssueEngine {
  constructor(private readonly defaults: IssueEngineOptions = {}) {}

  analyze(input: AnalyzeInput): AnalysisResult {
    return analyzeIssues({
      root: input.root,
      definitions: input.definitions,
      usages: input.usages,
      ...(input.dynamicUsages !== undefined
        ? { dynamicUsages: input.dynamicUsages }
        : {}),
      ...(input.untranslatedLiterals !== undefined
        ? { untranslatedLiterals: input.untranslatedLiterals }
        : {}),
      options: {
        ...this.defaults,
        ...input.options,
        severities: {
          ...this.defaults.severities,
          ...input.options?.severities,
        },
      },
    });
  }
}

export function createIssueEngine(
  defaults?: IssueEngineOptions,
): IssueEngine {
  return new DefaultIssueEngine(defaults);
}

export const issueEngineFactory: IssueEngineFactory = {
  createIssueEngine,
};
