import type { CallEdge, CallGraph, FunctionId } from "../api/types.js";

export class MutableCallGraph implements CallGraph {
  private readonly all: CallEdge[] = [];
  private readonly fromIndex = new Map<FunctionId, CallEdge[]>();
  private readonly toIndex = new Map<FunctionId, CallEdge[]>();

  get edges(): readonly CallEdge[] {
    return this.all;
  }

  callees(from: FunctionId): readonly CallEdge[] {
    return this.fromIndex.get(from) ?? [];
  }

  callers(to: FunctionId): readonly CallEdge[] {
    return this.toIndex.get(to) ?? [];
  }

  add(edge: CallEdge): void {
    this.all.push(edge);
    const fromList = this.fromIndex.get(edge.from);
    if (fromList) fromList.push(edge);
    else this.fromIndex.set(edge.from, [edge]);
    if (edge.to) {
      const toList = this.toIndex.get(edge.to);
      if (toList) toList.push(edge);
      else this.toIndex.set(edge.to, [edge]);
    }
  }

  clear(): void {
    this.all.length = 0;
    this.fromIndex.clear();
    this.toIndex.clear();
  }
}
