import type {
  ConstantBinding,
  ConstantDependencyGraph,
} from "../api/types.js";

export class MutableConstantGraph implements ConstantDependencyGraph {
  private readonly map = new Map<string, ConstantBinding>();

  get bindings(): readonly ConstantBinding[] {
    return [...this.map.values()].sort(
      (a, b) =>
        a.absolutePath.localeCompare(b.absolutePath) ||
        a.name.localeCompare(b.name),
    );
  }

  get(absolutePath: string, name: string): ConstantBinding | undefined {
    return this.map.get(key(absolutePath, name));
  }

  set(binding: ConstantBinding): void {
    this.map.set(key(binding.absolutePath, binding.name), binding);
  }

  clear(): void {
    this.map.clear();
  }
}

function key(absolutePath: string, name: string): string {
  return `${absolutePath}::${name}`;
}
