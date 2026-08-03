import type {
  AnalysisResult,
  AnalyzeInput,
  IssueEngine,
  IssueEngineOptions,
} from "./types.js";

export interface IssueEngineFactory {
  createIssueEngine(defaults?: IssueEngineOptions): IssueEngine;
}

export type { AnalysisResult, AnalyzeInput, IssueEngine, IssueEngineOptions };
