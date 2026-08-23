import {
  parseTree,
  type Node,
  type ParseError,
} from "jsonc-parser";
import type { SourceLocation } from "../api/types.js";
import {
  flattenLocated,
  type FlatEntry,
  type LocatedNode,
} from "./flatten.js";

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

function toLocated(
  node: Node,
  text: string,
  duplicates: string[],
  pathPrefix = "",
): LocatedNode {
  const location = offsetToLocation(text, node.offset, node.offset + node.length);
  if (node.type === "object" && node.children) {
    const children = new Map<string, LocatedNode>();
    const seen = new Set<string>();
    for (const prop of node.children) {
      if (prop.type !== "property" || !prop.children || prop.children.length < 2) {
        continue;
      }
      const keyNode = prop.children[0]!;
      const valueNode = prop.children[1]!;
      const key = String(keyNode.value);
      const full = pathPrefix ? `${pathPrefix}.${key}` : key;
      if (seen.has(key)) {
        duplicates.push(full);
      }
      seen.add(key);
      const valueLocated = toLocated(valueNode, text, duplicates, full);
      // Leaf entries underline the property key, not the translated value.
      if (valueLocated.children === undefined) {
        children.set(key, {
          ...valueLocated,
          location: offsetToLocation(
            text,
            keyNode.offset,
            keyNode.offset + keyNode.length,
          ),
        });
      } else {
        children.set(key, valueLocated);
      }
    }
    return { value: undefined, location, children };
  }
  if (node.type === "array" && node.children) {
    return {
      value: undefined,
      location,
      children: node.children.map((child, index) =>
        toLocated(
          child,
          text,
          duplicates,
          pathPrefix ? `${pathPrefix}[${index}]` : `[${index}]`,
        ),
      ),
    };
  }
  return {
    value: node.value as unknown,
    location,
  };
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function extractJsonEntries(text: string): {
  entries: FlatEntry[];
  rootLocation: SourceLocation;
  error?: string;
  duplicateKeys?: string[];
  empty?: boolean;
} {
  const cleaned = stripBom(text).trim();
  if (cleaned.length === 0) {
    return {
      entries: [],
      rootLocation: offsetToLocation(text, 0, Math.min(text.length, 1)),
      empty: true,
    };
  }

  const errors: ParseError[] = [];
  const tree = parseTree(cleaned, errors, { allowTrailingComma: true });
  if (!tree || (errors.length > 0 && !isRecoverableJsonTree(tree))) {
    return {
      entries: [],
      rootLocation: offsetToLocation(cleaned, 0, Math.min(cleaned.length, 1)),
      error: errors[0] ? "Invalid JSON" : "Empty JSON",
    };
  }

  const duplicates: string[] = [];
  const located = toLocated(tree, cleaned, duplicates);
  const entries = flattenLocated(located);

  if (errors.length > 0 && entries.length === 0) {
    return {
      entries: [],
      rootLocation: located.location,
      error: "Invalid JSON",
    };
  }

  return {
    entries,
    rootLocation: located.location,
    ...(duplicates.length > 0 ? { duplicateKeys: [...new Set(duplicates)] } : {}),
    ...(entries.length === 0 ? { empty: true } : {}),
  };
}

function isRecoverableJsonTree(tree: Node): boolean {
  return tree.type === "object" || tree.type === "array";
}
