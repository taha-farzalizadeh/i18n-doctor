import type { FunctionId } from "../api/types.js";

/** Internal per-function scope facts (not part of the public FunctionNode API). */
export interface FunctionScopeMeta {
  readonly id: FunctionId;
  /** Enclosing scope container start (UTF-16). */
  readonly scopeStart: number;
  /** Enclosing scope container end (UTF-16). */
  readonly scopeEnd: number;
  /**
   * FunctionDeclaration-style hoist: visible throughout the enclosing scope.
   * const/let arrows are only visible after declaration.
   */
  readonly hoisted: boolean;
}

/** Local name binding that may shadow seeds (functions + const aliases). */
export interface LocalNameBinding {
  readonly absolutePath: string;
  readonly name: string;
  readonly declPos: number;
  readonly scopeStart: number;
  readonly scopeEnd: number;
  readonly hoisted: boolean;
  /** Function id when this binding is a function node. */
  readonly functionId?: FunctionId;
}

export class ScopeMetaStore {
  private readonly byId = new Map<FunctionId, FunctionScopeMeta>();
  private readonly locals: LocalNameBinding[] = [];

  setFunction(meta: FunctionScopeMeta): void {
    this.byId.set(meta.id, meta);
  }

  getFunction(id: FunctionId): FunctionScopeMeta | undefined {
    return this.byId.get(id);
  }

  addLocal(binding: LocalNameBinding): void {
    this.locals.push(binding);
  }

  /** Innermost local binding for `name` visible at `position`. */
  findLocal(
    absolutePath: string,
    name: string,
    position: number,
  ): LocalNameBinding | undefined {
    let best: LocalNameBinding | undefined;
    for (const b of this.locals) {
      if (b.absolutePath !== absolutePath || b.name !== name) continue;
      if (!visibleAt(b, position)) continue;
      if (
        !best ||
        scopeDepth(b) > scopeDepth(best) ||
        (scopeDepth(b) === scopeDepth(best) && b.declPos >= best.declPos)
      ) {
        best = b;
      }
    }
    return best;
  }

  /** Merge another file's scope facts into this store. */
  mergeFrom(other: ScopeMetaStore): void {
    for (const [id, meta] of other.byId) {
      this.byId.set(id, meta);
    }
    for (const local of other.locals) {
      this.locals.push(local);
    }
  }

  clear(): void {
    this.byId.clear();
    this.locals.length = 0;
  }
}

export function visibleAt(
  b: Pick<LocalNameBinding, "scopeStart" | "scopeEnd" | "declPos" | "hoisted">,
  position: number,
): boolean {
  if (position < b.scopeStart || position > b.scopeEnd) return false;
  if (!b.hoisted && position < b.declPos) return false;
  return true;
}

function scopeDepth(b: Pick<LocalNameBinding, "scopeStart" | "scopeEnd">): number {
  // Smaller range ⇒ deeper nesting.
  return -(b.scopeEnd - b.scopeStart);
}
