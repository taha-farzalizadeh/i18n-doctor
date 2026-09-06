import { traversalApi } from "@i18n-doctor/ast";
import type { FileAliasAnalysis } from "@i18n-doctor/resolve";
import ts from "typescript";
import type {
  FileBindingTable,
  TranslationUsage,
  UsageLibraryId,
} from "../api/types.js";
import { resolveCalleeForUsage } from "./alias-resolve.js";
import {
  calleeIdentifier,
  endsWithProperty,
  rootIdentifier,
  staticStringKeys,
} from "./ast-helpers.js";
import { isI18nextFamily, isIntlObject } from "./bindings.js";
import { locationOf } from "./location.js";
import {
  resolveMappedPropKeys,
  type ObjectArrayPropIndex,
} from "./object-array-props.js";
import type { EnumValueIndex } from "./enum-values.js";
import type { HelperReturnIndex } from "./helper-returns.js";
import { buildUsage } from "./usage-builder.js";

/**
 * Emit usages for indirect key expressions:
 *   t(field.label) | t(descriptions[item]) | t(getTitle(...)) |
 *   t(matchedTitle) | Object.keys(Enum).map((k) => t(k))
 */
export function collectMappedPropUsages(input: {
  absolutePath: string;
  relativePath: string;
  sourceFile: ts.SourceFile;
  bindings: FileBindingTable;
  aliasAnalysis: FileAliasAnalysis;
  index: ObjectArrayPropIndex;
  enumIndex?: EnumValueIndex;
  helperIndex?: HelperReturnIndex;
}): TranslationUsage[] {
  const found: TranslationUsage[] = [];
  const seen = new Set<string>();
  const keyOpts = {
    relativePath: input.relativePath,
    ...(input.enumIndex ? { enumIndex: input.enumIndex } : {}),
  };

  traversalApi.forEachChild(input.sourceFile, (node) => {
    if (!ts.isCallExpression(node) || node.arguments.length === 0) {
      return;
    }
    const keyNode = node.arguments[0];
    if (!keyNode) return;

    const staticKeys = staticStringKeys(
      keyNode,
      input.sourceFile,
      new Set(),
      keyOpts,
    );
    const indirect = resolveMappedPropKeys(
      keyNode,
      input.sourceFile,
      input.relativePath,
      input.index,
      input.enumIndex,
      input.helperIndex,
    );
    // Cross-file string enums resolve via staticKeys + member access
    // (detectors lack the enum index). Other indirect patterns use the index.
    const keys =
      staticKeys.length > 0 && isMemberAccess(keyNode)
        ? staticKeys
        : indirect;
    if (keys.length === 0) return;

    const binding = resolveMappedCallee(
      node,
      input.bindings,
      input.aliasAnalysis,
      keyNode.getStart(input.sourceFile),
    );
    if (!binding) return;

    const location = locationOf(input.sourceFile, keyNode);
    for (const key of keys) {
      const resolvedKey = binding.keyPrefix
        ? `${binding.keyPrefix}.${key}`
        : key;
      const dedupe = `${input.relativePath}:${location.start}:${location.end}:${resolvedKey}:${binding.library}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);

      found.push(
        buildUsage({
          key: resolvedKey,
          absolutePath: input.absolutePath,
          relativePath: input.relativePath,
          location,
          library: binding.library,
          ...(binding.namespace !== undefined
            ? { namespace: binding.namespace }
            : {}),
          ...(binding.namespaces !== undefined
            ? { namespaces: binding.namespaces }
            : {}),
          namespaceResolved: binding.namespace !== undefined,
          confidence: Math.min(0.85, binding.confidence),
          context: "function-call",
          evidence: `${binding.evidence} (mapped object prop)`,
        }),
      );
    }
  });

  return found;
}

function isMemberAccess(expr: ts.Expression): boolean {
  let current = expr;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return (
    ts.isPropertyAccessExpression(current) ||
    ts.isElementAccessExpression(current)
  );
}

function resolveMappedCallee(
  node: ts.CallExpression,
  bindings: FileBindingTable,
  aliasAnalysis: FileAliasAnalysis,
  position: number,
):
  | {
      library: UsageLibraryId;
      confidence: number;
      namespace?: string;
      namespaces?: readonly string[];
      keyPrefix?: string;
      evidence: string;
    }
  | undefined {
  const ident = calleeIdentifier(node.expression);
  if (ident) {
    const alias = resolveCalleeForUsage(
      bindings,
      aliasAnalysis,
      ident,
      position,
    );
    if (
      alias.member &&
      alias.member.property === "t" &&
      (bindings.i18nObjects.has(alias.member.object) ||
        bindings.translationObjects.has(alias.member.object))
    ) {
      const objectBinding = bindings.translationObjects.get(alias.member.object);
      return {
        library: objectBinding?.library ?? "i18next",
        confidence: objectBinding?.confidence ?? 0.7,
        ...(objectBinding?.namespace !== undefined
          ? { namespace: objectBinding.namespace }
          : {}),
        ...(objectBinding?.namespaces !== undefined
          ? { namespaces: objectBinding.namespaces }
          : {}),
        ...(objectBinding?.keyPrefix !== undefined
          ? { keyPrefix: objectBinding.keyPrefix }
          : {}),
        evidence: `mapped-prop: ${alias.member.object}.t`,
      };
    }
    if (alias.binding) {
      return {
        library: alias.binding.library,
        confidence: alias.binding.confidence,
        ...(alias.binding.namespace !== undefined
          ? { namespace: alias.binding.namespace }
          : {}),
        ...(alias.binding.namespaces !== undefined
          ? { namespaces: alias.binding.namespaces }
          : {}),
        ...(alias.binding.keyPrefix !== undefined
          ? { keyPrefix: alias.binding.keyPrefix }
          : {}),
        evidence: `mapped-prop: ${alias.binding.origin}`,
      };
    }
    if (bindings.formatMessageNames.has(ident) || ident === "formatMessage") {
      return {
        library: "react-intl",
        confidence: 0.7,
        evidence: "mapped-prop: formatMessage",
      };
    }
  }

  if (endsWithProperty(node.expression, "t")) {
    const root = rootIdentifier(node.expression);
    if (
      root &&
      (bindings.i18nObjects.has(root) || bindings.translationObjects.has(root))
    ) {
      const objectBinding = bindings.translationObjects.get(root);
      const library = objectBinding?.library ?? "i18next";
      return {
        library:
          isI18nextFamily(library) || library === "vue-i18n"
            ? library
            : "i18next",
        confidence: objectBinding?.confidence ?? 0.7,
        ...(objectBinding?.namespace !== undefined
          ? { namespace: objectBinding.namespace }
          : {}),
        evidence: `mapped-prop: ${root}.t`,
      };
    }
  }

  if (endsWithProperty(node.expression, "formatMessage")) {
    const root = rootIdentifier(node.expression);
    if (root && isIntlObject(bindings, root)) {
      return {
        library: "react-intl",
        confidence: 0.7,
        evidence: `mapped-prop: ${root}.formatMessage`,
      };
    }
  }

  return undefined;
}
