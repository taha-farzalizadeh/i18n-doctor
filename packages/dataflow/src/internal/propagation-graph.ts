import type {
  PropagationNode,
  ValuePropagationGraph,
} from "../api/types.js";

export class MutablePropagationGraph implements ValuePropagationGraph {
  private readonly map = new Map<string, PropagationNode>();

  get nodes(): readonly PropagationNode[] {
    return [...this.map.values()].sort(
      (a, b) =>
        a.absolutePath.localeCompare(b.absolutePath) ||
        a.location.start - b.location.start ||
        a.name.localeCompare(b.name),
    );
  }

  get(id: string): PropagationNode | undefined {
    return this.map.get(id);
  }

  set(node: PropagationNode): void {
    this.map.set(node.id, node);
  }

  clear(): void {
    this.map.clear();
  }
}
