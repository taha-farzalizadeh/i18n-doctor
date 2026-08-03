import type { DataFlowEngine, DataFlowEngineOptions } from "./types.js";

export interface DataFlowEngineFactory {
  createDataFlowEngine(options: DataFlowEngineOptions): DataFlowEngine;
}

export type { DataFlowEngine, DataFlowEngineOptions };
