/**
 * Locale Tree Model — rebuild nested structure from flat dotted catalog keys.
 * Single-pass freeze (no duplicated node cloning).
 */

import type { TranslationKeyDefinition } from "@i18n-doctor/sources";
import type { LocaleTree, LocaleTreeNode } from "../api/types.js";

interface MutableNode {
  segment: string;
  fullKey: string;
  children: Map<string, MutableNode>;
  byLocale: Map<string, TranslationKeyDefinition>;
  isLeaf: boolean;
  /** Cached frozen view — built once. */
  frozen?: LocaleTreeNode;
}

/** Split on `.` only — matches @i18n-doctor/sources flatten (`items[0].label`). */
export function splitKeyPath(key: string): string[] {
  if (!key) return [];
  return key.split(".");
}

const EMPTY_TREE: LocaleTree = {
  locales: [],
  root: {
    segment: "",
    fullKey: "",
    children: new Map(),
    byLocale: new Map(),
    isLeaf: false,
  },
  byKey: new Map(),
  leafCount: 0,
};

export function emptyLocaleTree(
  locales: readonly string[] = [],
  namespace?: string,
): LocaleTree {
  if (!namespace && locales.length === 0) return EMPTY_TREE;
  return {
    ...(namespace !== undefined ? { namespace } : {}),
    locales,
    root: EMPTY_TREE.root,
    byKey: EMPTY_TREE.byKey,
    leafCount: 0,
  };
}

export function buildLocaleTree(
  entries: ReadonlyMap<string, ReadonlyMap<string, TranslationKeyDefinition>>,
  locales: readonly string[],
  namespace?: string,
): LocaleTree {
  if (entries.size === 0) {
    return emptyLocaleTree(locales, namespace);
  }

  const root: MutableNode = {
    segment: "",
    fullKey: "",
    children: new Map(),
    byLocale: new Map(),
    isLeaf: false,
  };
  const byKeyMutable = new Map<string, MutableNode>();
  let leafCount = 0;

  for (const [key, byLocale] of entries) {
    const parts = splitKeyPath(key);
    let node = root;
    let path = "";
    for (let i = 0; i < parts.length; i += 1) {
      const seg = parts[i]!;
      path = path ? `${path}.${seg}` : seg;
      let child = node.children.get(seg);
      if (!child) {
        child = {
          segment: seg,
          fullKey: path,
          children: new Map(),
          byLocale: new Map(),
          isLeaf: false,
        };
        node.children.set(seg, child);
        byKeyMutable.set(path, child);
      }
      node = child;
    }
    for (const [locale, def] of byLocale) {
      node.byLocale.set(locale, def);
    }
    if (!node.isLeaf) {
      node.isLeaf = true;
      leafCount += 1;
    }
  }

  const frozenRoot = freezeNode(root);
  const byKey = new Map<string, LocaleTreeNode>();
  for (const [k, v] of byKeyMutable) {
    byKey.set(k, v.frozen ?? freezeNode(v));
  }

  return {
    ...(namespace !== undefined ? { namespace } : {}),
    locales,
    root: frozenRoot,
    byKey,
    leafCount,
  };
}

function freezeNode(node: MutableNode): LocaleTreeNode {
  if (node.frozen) return node.frozen;
  const children = new Map<string, LocaleTreeNode>();
  for (const [k, v] of node.children) {
    children.set(k, freezeNode(v));
  }
  const frozen: LocaleTreeNode = {
    segment: node.segment,
    fullKey: node.fullKey,
    children,
    byLocale: node.byLocale,
    isLeaf: node.isLeaf,
  };
  node.frozen = frozen;
  return frozen;
}

/** Walk tree depth-first; useful for nested key comparison reports. */
export function walkLocaleTree(
  tree: LocaleTree,
  visit: (node: LocaleTreeNode, depth: number) => void,
): void {
  const walk = (node: LocaleTreeNode, depth: number) => {
    if (node.fullKey !== "" || node.isLeaf) {
      visit(node, depth);
    }
    for (const child of node.children.values()) {
      walk(child, depth + 1);
    }
  };
  for (const child of tree.root.children.values()) {
    walk(child, 0);
  }
}
