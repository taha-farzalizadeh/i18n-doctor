import { traversalApi } from "@i18n-unused/ast";
import ts from "typescript";
import type { LibraryUsageDetector, TranslationUsage } from "../../api/types.js";
import { calleeIdentifier, staticStringKey } from "../ast-helpers.js";
import {
  fileImportsLibrary,
  LINGUI_MODULES,
  resolveTFunction,
} from "../bindings.js";
import { locationOf } from "../location.js";
import { buildUsage } from "../usage-builder.js";

/**
 * Lingui:
 * - msg("key") / t("key") when imported from @lingui/*
 * - tagged templates: msg`Message` / t`Message`
 */
export const linguiUsageDetector: LibraryUsageDetector = {
  id: "lingui",
  detect(input) {
    const usages: TranslationUsage[] = [];
    const { sourceFile, bindings, absolutePath, relativePath } = input;
    const hasLinguiImport = fileImportsLibrary(bindings, LINGUI_MODULES);
    const relevant =
      hasLinguiImport ||
      [...bindings.tFunctions.values()].some((b) => b.library === "lingui");

    if (!relevant) {
      return usages;
    }

    traversalApi.forEachChild(sourceFile, (node) => {
      if (ts.isCallExpression(node) && node.arguments.length > 0) {
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
        if (binding) {
          if (binding.library !== "lingui") {
            return;
          }
        } else if (!(hasLinguiImport && (ident === "msg" || ident === "t"))) {
          return;
        }
        usages.push(
          buildUsage({
            key,
            absolutePath,
            relativePath,
            location: locationOf(sourceFile, keyNode),
            library: "lingui",
            confidence: binding?.confidence ?? 0.85,
            context: "function-call",
            evidence: `lingui-detector: ${binding?.origin ?? `${ident}(...)`}`,
          }),
        );
      }

      if (ts.isTaggedTemplateExpression(node)) {
        const tag = calleeIdentifier(node.tag);
        if (!tag) {
          return;
        }
        const binding = resolveTFunction(
          bindings,
          tag,
          node.tag.getStart(sourceFile),
        );
        if (binding) {
          if (binding.library !== "lingui") {
            return;
          }
        } else if (!(hasLinguiImport && (tag === "msg" || tag === "t"))) {
          return;
        }
        const tpl = node.template;
        if (ts.isNoSubstitutionTemplateLiteral(tpl)) {
          usages.push(
            buildUsage({
              key: tpl.text,
              absolutePath,
              relativePath,
              location: locationOf(sourceFile, tpl),
              library: "lingui",
              confidence: 0.8,
              context: "tagged-template",
              evidence: `lingui-detector: ${tag}\`...\``,
            }),
          );
        }
      }
    });

    return usages;
  },
};
