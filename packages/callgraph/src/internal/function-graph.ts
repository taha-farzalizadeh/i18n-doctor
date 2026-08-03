import type {
  FunctionGraph,
  FunctionId,
  FunctionNode,
} from "../api/types.js";
import { visibleAt, type ScopeMetaStore } from "./scope-meta.js";

export class MutableFunctionGraph implements FunctionGraph {
  private readonly map = new Map<FunctionId, FunctionNode>();
  private readonly byFile = new Map<string, FunctionId[]>();
  private scopes: ScopeMetaStore | undefined;

  attachScopes(scopes: ScopeMetaStore): void {
    this.scopes = scopes;
  }

  get functions(): readonly FunctionNode[] {
    return [...this.map.values()].sort(
      (a, b) =>
        a.absolutePath.localeCompare(b.absolutePath) ||
        a.location.start - b.location.start ||
        a.name.localeCompare(b.name),
    );
  }

  get(id: FunctionId): FunctionNode | undefined {
    return this.map.get(id);
  }

  inFile(absolutePath: string): readonly FunctionNode[] {
    const ids = this.byFile.get(absolutePath) ?? [];
    return ids
      .map((id) => this.map.get(id))
      .filter((n): n is FunctionNode => n !== undefined);
  }

  findByName(
    absolutePath: string,
    name: string,
    position?: number,
  ): FunctionNode | undefined {
    if (this.scopes && position !== undefined) {
      const local = this.scopes.findLocal(absolutePath, name, position);
      if (local?.functionId) {
        return this.map.get(local.functionId);
      }
    }

    const nodes = this.inFile(absolutePath).filter((n) => n.name === name);
    if (nodes.length === 0) return undefined;
    if (position === undefined) {
      return nodes[nodes.length - 1];
    }

    let best: FunctionNode | undefined;
    for (const n of nodes) {
      const meta = this.scopes?.getFunction(n.id);
      if (meta) {
        if (
          !visibleAt(
            {
              scopeStart: meta.scopeStart,
              scopeEnd: meta.scopeEnd,
              declPos: n.location.start,
              hoisted: meta.hoisted,
            },
            position,
          )
        ) {
          continue;
        }
      } else if (n.location.start > position) {
        continue;
      }
      if (!best || n.location.start >= best.location.start) {
        best = n;
      }
    }
    return best ?? nodes[nodes.length - 1];
  }

  set(node: FunctionNode): void {
    this.map.set(node.id, node);
    const list = this.byFile.get(node.absolutePath);
    if (list) {
      if (!list.includes(node.id)) list.push(node.id);
    } else {
      this.byFile.set(node.absolutePath, [node.id]);
    }
  }

  clear(): void {
    this.map.clear();
    this.byFile.clear();
  }
}
