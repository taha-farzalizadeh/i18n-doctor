import { traversalApi } from "@i18n-unused/ast";
import ts from "typescript";
import type { LibraryUsageDetector, TranslationUsage } from "../../api/types.js";
import {
  calleeIdentifier,
  endsWithProperty,
  rootIdentifier,
  staticStringKey,
} from "../ast-helpers.js";
import { resolveCalleeForUsage } from "../alias-resolve.js";
import {
  fileImportsLibrary,
  I18NEXT_MODULES,
  isI18nextFamily,
} from "../bindings.js";
import { locationOf } from "../location.js";
import { buildUsage } from "../usage-builder.js";

/**
 * i18next / react-i18next / next-i18next:
 * - t("key") when t is file-locally bound from useTranslation
 * - i18n.t("key") / i18next.t("key")
 * - renamed: const { t: translate } = useTranslation()
 */
export const i18nextUsageDetector: LibraryUsageDetector = {
  id: "react-i18next",
  detect(input) {
    const usages: TranslationUsage[] = [];
    const { sourceFile, bindings, absolutePath, relativePath } = input;
    const relevant =
      bindings.hooks.useTranslation ||
      [...bindings.tFunctions.values()].some((b) => isI18nextFamily(b.library)) ||
      bindings.i18nObjects.size > 0 ||
      fileImportsLibrary(bindings, I18NEXT_MODULES);

    if (!relevant) {
      return usages;
    }

    traversalApi.forEachChild(sourceFile, (node) => {
      if (!ts.isCallExpression(node) || node.arguments.length === 0) {
        return;
      }

      const keyNode = node.arguments[0];
      const key = staticStringKey(keyNode);
      if (key === undefined || !keyNode) {
        return;
      }

      const ident = calleeIdentifier(node.expression);
      if (ident) {
        const pos = keyNode.getStart(sourceFile);
        const alias = resolveCalleeForUsage(
          bindings,
          input.aliasAnalysis,
          ident,
          pos,
        );

        if (
          alias.member &&
          alias.member.property === "t" &&
          bindings.i18nObjects.has(alias.member.object)
        ) {
          usages.push(
            buildUsage({
              key,
              absolutePath,
              relativePath,
              location: locationOf(sourceFile, keyNode),
              library: fileImportsLibrary(bindings, new Set(["react-i18next"]))
                ? "react-i18next"
                : fileImportsLibrary(bindings, new Set(["next-i18next"]))
                  ? "next-i18next"
                  : "i18next",
              confidence: Math.min(0.88, alias.resolution.confidence),
              context: "function-call",
              evidence: `i18next-detector: ${alias.aliasEvidence ?? `${alias.member.object}.t`}`,
            }),
          );
          return;
        }

        const binding = alias.binding;
        if (binding && isI18nextFamily(binding.library)) {
          usages.push(
            buildUsage({
              key,
              absolutePath,
              relativePath,
              location: locationOf(sourceFile, keyNode),
              library: binding.library,
              ...(binding.namespace !== undefined
                ? { namespace: binding.namespace }
                : {}),
              confidence: Math.min(
                binding.confidence,
                alias.resolution.confidence,
              ),
              context: "function-call",
              evidence: `i18next-detector: ${binding.origin}${
                alias.aliasEvidence ? ` (${alias.aliasEvidence})` : ""
              }`,
            }),
          );
          return;
        }
      }

      if (endsWithProperty(node.expression, "t")) {
        const root = rootIdentifier(node.expression);
        if (root && bindings.i18nObjects.has(root)) {
          usages.push(
            buildUsage({
              key,
              absolutePath,
              relativePath,
              location: locationOf(sourceFile, keyNode),
              library: fileImportsLibrary(bindings, new Set(["react-i18next"]))
                ? "react-i18next"
                : fileImportsLibrary(bindings, new Set(["next-i18next"]))
                  ? "next-i18next"
                  : "i18next",
              confidence: 0.88,
              context: "member-call",
              evidence: `i18next-detector: ${root}.….t(...)`,
            }),
          );
        }
      }
    });

    return usages;
  },
};
