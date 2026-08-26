import { traversalApi } from "@i18n-doctor/ast";
import type { FileAliasAnalysis } from "@i18n-doctor/resolve";
import ts from "typescript";
import type {
  DynamicTranslationUsage,
  FileBindingTable,
  UsageLibraryId,
} from "../api/types.js";
import { resolveCalleeForUsage } from "./alias-resolve.js";
import {
  calleeIdentifier,
  endsWithProperty,
  rootIdentifier,
  staticKeyFragments,
  staticStringKey,
} from "./ast-helpers.js";
import { isI18nextFamily, isIntlObject } from "./bindings.js";
import { locationOf } from "./location.js";

/**
 * Collect translator calls whose key argument is not fully static.
 * Known fragments (prefix/suffix) later soften unused-key diagnostics.
 */
export function collectDynamicUsages(input: {
  absolutePath: string;
  relativePath: string;
  sourceFile: ts.SourceFile;
  bindings: FileBindingTable;
  aliasAnalysis: FileAliasAnalysis;
}): DynamicTranslationUsage[] {
  const found: DynamicTranslationUsage[] = [];
  const seen = new Set<string>();

  traversalApi.forEachChild(input.sourceFile, (node) => {
    if (!ts.isCallExpression(node) || node.arguments.length === 0) {
      return;
    }
    const keyNode = node.arguments[0];
    if (!keyNode || staticStringKey(keyNode, input.sourceFile) !== undefined) {
      return;
    }

    const binding = resolveDynamicCallee(
      node,
      input.bindings,
      input.aliasAnalysis,
      keyNode.getStart(input.sourceFile),
    );
    if (!binding) {
      return;
    }

    const fragments = staticKeyFragments(keyNode, input.sourceFile);
    if (
      fragments.prefixes.length === 0 &&
      fragments.suffixes.length === 0 &&
      fragments.contains.length === 0
    ) {
      // Fully opaque keys (e.g. t(name)) — no fragment to match against catalog keys.
      return;
    }

    const location = locationOf(input.sourceFile, keyNode);
    const dedupe = `${input.relativePath}:${location.start}:${location.end}`;
    if (seen.has(dedupe)) {
      return;
    }
    seen.add(dedupe);

    found.push({
      absolutePath: input.absolutePath,
      relativePath: input.relativePath,
      location,
      library: binding.library,
      ...(binding.namespace !== undefined ? { namespace: binding.namespace } : {}),
      ...(binding.namespaces !== undefined
        ? { namespaces: binding.namespaces }
        : {}),
      confidence: Math.min(0.45, binding.confidence),
      context: "function-call",
      evidence: binding.evidence,
      prefixes: fragments.prefixes,
      suffixes: fragments.suffixes,
      contains: fragments.contains,
    });
  });

  return found;
}

function resolveDynamicCallee(
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
        evidence: `dynamic-key: ${alias.member.object}.t`,
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
        evidence: `dynamic-key: ${alias.binding.origin}`,
      };
    }
    if (bindings.formatMessageNames.has(ident) || ident === "formatMessage") {
      return {
        library: "react-intl",
        confidence: 0.7,
        evidence: "dynamic-key: formatMessage",
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
        library: isI18nextFamily(library) || library === "vue-i18n"
          ? library
          : "i18next",
        confidence: objectBinding?.confidence ?? 0.7,
        ...(objectBinding?.namespace !== undefined
          ? { namespace: objectBinding.namespace }
          : {}),
        evidence: `dynamic-key: ${root}.t`,
      };
    }
  }

  if (endsWithProperty(node.expression, "formatMessage")) {
    const root = rootIdentifier(node.expression);
    if (root && isIntlObject(bindings, root)) {
      return {
        library: "react-intl",
        confidence: 0.7,
        evidence: `dynamic-key: ${root}.formatMessage`,
      };
    }
  }

  return undefined;
}
