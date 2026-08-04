import { traversalApi } from "@i18n-doctor/ast";
import ts from "typescript";
import type { LibraryUsageDetector, TranslationUsage } from "../../api/types.js";
import { resolveCalleeForUsage } from "../alias-resolve.js";
import { calleeIdentifier, staticStringKey } from "../ast-helpers.js";
import {
  fileImportsLibrary,
  NEXT_INTL_MODULES,
} from "../bindings.js";
import { locationOf } from "../location.js";
import { buildUsage } from "../usage-builder.js";

/**
 * next-intl:
 * - const t = useTranslations('Namespace')
 * - t('key')
 */
export const nextIntlUsageDetector: LibraryUsageDetector = {
  id: "next-intl",
  detect(input) {
    const usages: TranslationUsage[] = [];
    const { sourceFile, bindings, absolutePath, relativePath } = input;
    const relevant =
      bindings.hooks.useTranslations ||
      fileImportsLibrary(bindings, NEXT_INTL_MODULES) ||
      [...bindings.tFunctions.values()].some((b) => b.library === "next-intl");

    if (!relevant) {
      return usages;
    }

    traversalApi.forEachChild(sourceFile, (node) => {
      if (!ts.isCallExpression(node) || node.arguments.length === 0) {
        return;
      }
      const ident = calleeIdentifier(node.expression);
      if (!ident) {
        return;
      }
      const keyNode = node.arguments[0];
      const key = staticStringKey(keyNode);
      if (key === undefined || !keyNode) {
        return;
      }
      const pos = keyNode.getStart(sourceFile);
      const alias = resolveCalleeForUsage(
        bindings,
        input.aliasAnalysis,
        ident,
        pos,
      );
      const binding = alias.binding;
      if (!binding || binding.library !== "next-intl") {
        return;
      }
      const resolvedKey = binding.keyPrefix
        ? `${binding.keyPrefix}.${key}`
        : key;
      usages.push(
        buildUsage({
          key: resolvedKey,
          absolutePath,
          relativePath,
          location: locationOf(sourceFile, keyNode),
          library: "next-intl",
          ...(binding.namespace !== undefined
            ? { namespace: binding.namespace }
            : {}),
          namespaceResolved: binding.namespace !== undefined,
          confidence: Math.min(
            binding.confidence,
            alias.resolution.confidence,
          ),
          context: "function-call",
          evidence: `next-intl-detector: ${binding.origin}${
            alias.aliasEvidence ? ` (${alias.aliasEvidence})` : ""
          }${binding.keyPrefix ? ` keyPrefix=${binding.keyPrefix}` : ""}`,
        }),
      );
    });

    return usages;
  },
};
