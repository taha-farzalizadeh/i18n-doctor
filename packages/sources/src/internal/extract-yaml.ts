import { parseDocument, isMap, isSeq, isScalar, type Node, type Pair } from "yaml";
import type { SourceLocation } from "../api/types.js";
import {
  flattenLocated,
  type FlatEntry,
  type LocatedNode,
} from "./flatten.js";

function rangeToLocation(
  text: string,
  range: [number, number, number] | null | undefined,
): SourceLocation {
  if (!range) {
    return { startLine: 1, startCharacter: 1, endLine: 1, endCharacter: 1 };
  }
  const start = range[0];
  const end = range[1];
  return offsetToLocation(text, start, end);
}

function offsetToLocation(
  text: string,
  start: number,
  end: number,
): SourceLocation {
  const startLc = offsetToLineChar(text, start);
  const endLc = offsetToLineChar(text, Math.max(start, end));
  return {
    start,
    end,
    startLine: startLc.line,
    startCharacter: startLc.character,
    endLine: endLc.line,
    endCharacter: endLc.character,
  };
}

function offsetToLineChar(
  text: string,
  offset: number,
): { line: number; character: number } {
  let line = 1;
  let character = 1;
  const clamped = Math.max(0, Math.min(offset, text.length));
  for (let i = 0; i < clamped; i += 1) {
    if (text[i] === "\n") {
      line += 1;
      character = 1;
    } else {
      character += 1;
    }
  }
  return { line, character };
}

function nodeToLocated(node: Node | null | undefined, text: string): LocatedNode {
  const location = rangeToLocation(text, node?.range ?? null);
  if (!node) {
    return { value: null, location };
  }
  if (isScalar(node)) {
    return { value: node.value as unknown, location };
  }
  if (isMap(node)) {
    const children = new Map<string, LocatedNode>();
    for (const item of node.items as Pair[]) {
      const keyNode = item.key;
      const valueNode = item.value as Node | null;
      let key = "";
      if (isScalar(keyNode)) {
        key = String(keyNode.value);
      } else if (keyNode != null) {
        key = String(keyNode);
      }
      if (!key) {
        continue;
      }
      children.set(key, nodeToLocated(valueNode, text));
    }
    return { value: undefined, location, children };
  }
  if (isSeq(node)) {
    return {
      value: undefined,
      location,
      children: node.items.map((item) =>
        nodeToLocated(item as Node, text),
      ),
    };
  }
  return { value: null, location };
}

export function extractYamlEntries(text: string): {
  entries: FlatEntry[];
  rootLocation: SourceLocation;
  error?: string;
} {
  try {
    const doc = parseDocument(text, { prettyErrors: true });
    if (doc.errors.length > 0 && !doc.contents) {
      return {
        entries: [],
        rootLocation: offsetToLocation(text, 0, Math.min(1, text.length)),
        error: doc.errors[0]?.message ?? "Invalid YAML",
      };
    }
    const located = nodeToLocated(doc.contents as Node | null, text);
    return {
      entries: flattenLocated(located),
      rootLocation: located.location,
    };
  } catch (error) {
    return {
      entries: [],
      rootLocation: offsetToLocation(text, 0, Math.min(1, text.length)),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
