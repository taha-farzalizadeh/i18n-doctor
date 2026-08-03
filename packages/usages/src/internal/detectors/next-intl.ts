import { traversalApi } from "@i18n-unused/ast";
import ts from "typescript";
import type { LibraryUsageDetector, TranslationUsage } from "../../api/types.js";
import { calleeIdentifier, staticStringKey } from "../ast-helpers.js";
import {
  fileImportsLibrary,
  NEXT_INTL_MODULES,
  resolveTFunction,
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
      const binding = resolveTFunction(
        bindings,
        ident,
        keyNode.getStart(sourceFile),
      );
      if (!binding || binding.library !== "next-intl") {
        return;
      }
      usages.push(
        buildUsage({
          key,
          absolutePath,
          relativePath,
          location: locationOf(sourceFile, keyNode),
          library: "next-intl",
          ...(binding.namespace !== undefined
            ? { namespace: binding.namespace }
            : {}),
          confidence: binding.confidence,
          context: "function-call",
          evidence: `next-intl-detector: ${binding.origin}`,
        }),
      );
    });

    return usages;
  },
};
