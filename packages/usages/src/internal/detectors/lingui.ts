import { traversalApi } from "@i18n-doctor/ast";
import ts from "typescript";
import type { LibraryUsageDetector, TranslationUsage } from "../../api/types.js";
import { resolveCalleeForUsage } from "../alias-resolve.js";
import { calleeIdentifier, staticStringKey } from "../ast-helpers.js";
import {
  fileImportsLibrary,
  LINGUI_MODULES,
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
        const key = staticStringKey(keyNode, sourceFile);
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
        if (binding) {
          if (binding.library !== "lingui") {
            return;
          }
        } else if (
          !(
            hasLinguiImport &&
            (alias.lookupName === "msg" || alias.lookupName === "t")
          )
        ) {
          return;
        }
        usages.push(
          buildUsage({
            key,
            absolutePath,
            relativePath,
            location: locationOf(sourceFile, keyNode),
            library: "lingui",
            confidence: Math.min(
              binding?.confidence ?? 0.85,
              alias.resolution.confidence,
            ),
            context: "function-call",
            evidence: `lingui-detector: ${binding?.origin ?? `${ident}(...)`}${
              alias.aliasEvidence ? ` (${alias.aliasEvidence})` : ""
            }`,
          }),
        );
      }

      if (ts.isTaggedTemplateExpression(node)) {
        const tag = calleeIdentifier(node.tag);
        if (!tag) {
          return;
        }
        const pos = node.tag.getStart(sourceFile);
        const alias = resolveCalleeForUsage(
          bindings,
          input.aliasAnalysis,
          tag,
          pos,
        );
        const binding = alias.binding;
        if (binding) {
          if (binding.library !== "lingui") {
            return;
          }
        } else if (
          !(
            hasLinguiImport &&
            (alias.lookupName === "msg" || alias.lookupName === "t")
          )
        ) {
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
              confidence: Math.min(0.8, alias.resolution.confidence),
              context: "tagged-template",
              evidence: `lingui-detector: ${tag}\`...\`${
                alias.aliasEvidence ? ` (${alias.aliasEvidence})` : ""
              }`,
            }),
          );
        }
      }
    });

    return usages;
  },
};
