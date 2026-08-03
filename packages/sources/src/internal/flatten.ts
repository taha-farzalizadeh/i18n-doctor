import type { SourceLocation, TranslationValue } from "../api/types.js";

export interface FlatEntry {
  readonly key: string;
  readonly value: TranslationValue;
  readonly location: SourceLocation;
}

export interface LocatedNode {
  readonly value: unknown;
  readonly location: SourceLocation;
  readonly children?: ReadonlyMap<string, LocatedNode> | readonly LocatedNode[];
}

const FILE_LOCATION: SourceLocation = {
  startLine: 1,
  startCharacter: 1,
  endLine: 1,
  endCharacter: 1,
};

export function isTranslationLeaf(value: unknown): value is TranslationValue {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  );
}

/** FormatJS / react-intl message descriptor object. */
export function isMessageDescriptor(node: LocatedNode): boolean {
  if (!(node.children instanceof Map)) {
    return false;
  }
  const hasDefault =
    node.children.has("defaultMessage") || node.children.has("default");
  const hasId = node.children.has("id");
  // Descriptor-like: has defaultMessage, optionally id/description.
  if (!hasDefault && !hasId) {
    return false;
  }
  // Avoid treating arbitrary objects with an `id` field as descriptors.
  if (!hasDefault) {
    return false;
  }
  for (const key of node.children.keys()) {
    if (
      key !== "id" &&
      key !== "defaultMessage" &&
      key !== "default" &&
      key !== "description"
    ) {
      return false;
    }
  }
  return true;
}

/** Flatten a plain JS value tree without locations (fallback). */
export function flattenValue(
  value: unknown,
  prefix = "",
  location: SourceLocation = FILE_LOCATION,
): FlatEntry[] {
  const out: FlatEntry[] = [];
  walkPlain(value, prefix, location, out);
  return out;
}

function walkPlain(
  value: unknown,
  prefix: string,
  location: SourceLocation,
  out: FlatEntry[],
): void {
  if (isTranslationLeaf(value)) {
    if (prefix) {
      out.push({ key: prefix, value, location });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const next = prefix ? `${prefix}[${index}]` : `[${index}]`;
      walkPlain(item, next, location, out);
    });
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const next = prefix ? `${prefix}.${k}` : k;
      walkPlain(v, next, location, out);
    }
  }
}

/** Flatten a located tree (JSONC / YAML / AST-backed). */
export function flattenLocated(
  node: LocatedNode,
  prefix = "",
  options: { maxKeys?: number } = {},
): FlatEntry[] {
  const out: FlatEntry[] = [];
  walkLocated(node, prefix, out, options.maxKeys ?? 50_000);
  return out;
}

function walkLocated(
  node: LocatedNode,
  prefix: string,
  out: FlatEntry[],
  maxKeys: number,
): void {
  if (out.length >= maxKeys) {
    return;
  }
  if (isTranslationLeaf(node.value)) {
    if (prefix) {
      out.push({ key: prefix, value: node.value, location: node.location });
    }
    return;
  }
  if (isMessageDescriptor(node)) {
    const children = node.children as Map<string, LocatedNode>;
    const idNode = children.get("id");
    const msgNode =
      children.get("defaultMessage") ?? children.get("default");
    const key =
      idNode && typeof idNode.value === "string" && idNode.value
        ? idNode.value
        : prefix;
    const value = msgNode && isTranslationLeaf(msgNode.value) ? msgNode.value : "";
    if (key) {
      out.push({
        key,
        value,
        location: msgNode?.location ?? node.location,
      });
    }
    return;
  }
  if (Array.isArray(node.children)) {
    for (let index = 0; index < node.children.length; index += 1) {
      if (out.length >= maxKeys) {
        return;
      }
      const child = node.children[index]!;
      const next = prefix ? `${prefix}[${index}]` : `[${index}]`;
      walkLocated(child, next, out, maxKeys);
    }
    return;
  }
  if (node.children instanceof Map) {
    for (const [k, child] of node.children) {
      if (out.length >= maxKeys) {
        return;
      }
      const next = prefix ? `${prefix}.${k}` : k;
      walkLocated(child, next, out, maxKeys);
    }
  }
}

/** Score how translation-like a flattened entry set is. */
export function scoreStringLeafRatio(entries: readonly FlatEntry[]): number {
  if (entries.length === 0) {
    return 0;
  }
  const strings = entries.filter((e) => typeof e.value === "string").length;
  return strings / entries.length;
}
