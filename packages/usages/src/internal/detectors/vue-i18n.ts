import { traversalApi } from "@i18n-doctor/ast";
import ts from "typescript";
import type { LibraryUsageDetector, TranslationUsage } from "../../api/types.js";
import {
  calleeIdentifier,
  endsWithProperty,
  rootIdentifier,
  staticStringKeys,
} from "../ast-helpers.js";
import { resolveCalleeForUsage } from "../alias-resolve.js";
import {
  fileImportsLibrary,
  VUE_I18N_MODULES,
} from "../bindings.js";
import { locationOf } from "../location.js";
import { buildUsage } from "../usage-builder.js";

/**
 * vue-i18n (script):
 * - i18n.t("key") / i18n.global.t("key")
 * - this.$t("key")
 * - t("key") when bound from useI18n
 */
export const vueI18nUsageDetector: LibraryUsageDetector = {
  id: "vue-i18n",
  detect(input) {
    const usages: TranslationUsage[] = [];
    const { sourceFile, bindings, absolutePath, relativePath } = input;
    const relevant =
      fileImportsLibrary(bindings, VUE_I18N_MODULES) ||
      [...bindings.tFunctions.values()].some((b) => b.library === "vue-i18n") ||
      bindings.i18nObjects.has("i18n");

    traversalApi.forEachChild(sourceFile, (node) => {
      if (!ts.isCallExpression(node) || node.arguments.length === 0) {
        return;
      }
      const keyNode = node.arguments[0];
      const keys = staticStringKeys(keyNode, sourceFile);
      if (keys.length === 0 || !keyNode) {
        return;
      }

      const pushKeys = (
        fields: Omit<Parameters<typeof buildUsage>[0], "key" | "absolutePath" | "relativePath" | "location">,
      ): void => {
        for (const key of keys) {
          usages.push(
            buildUsage({
              key,
              absolutePath,
              relativePath,
              location: locationOf(sourceFile, keyNode),
              ...fields,
            }),
          );
        }
      };

      const ident = calleeIdentifier(node.expression);
      if (ident) {
        const pos = keyNode.getStart(sourceFile);
        const alias = resolveCalleeForUsage(
          bindings,
          input.aliasAnalysis,
          ident,
          pos,
        );
        const binding = alias.binding;
        if (binding?.library === "vue-i18n") {
          pushKeys({
            library: "vue-i18n",
            confidence: Math.min(
              binding.confidence,
              alias.resolution.confidence,
            ),
            context: "function-call",
            evidence: `vue-i18n-detector: ${binding.origin}${
              alias.aliasEvidence ? ` (${alias.aliasEvidence})` : ""
            }`,
          });
          return;
        }
        // Nuxt auto-imports `t` / `$t` without a local binding.
        if (
          (ident === "t" || ident === "$t") &&
          hasNuxtI18nHint(input.libraryHints)
        ) {
          pushKeys({
            library: "vue-i18n",
            confidence: 0.72,
            context: "function-call",
            evidence: `vue-i18n-detector: nuxt auto-import ${ident}(...)`,
            framework: "nuxt",
            detector: "vue-i18n-detector",
          });
          return;
        }
      }

      if (endsWithProperty(node.expression, "$t")) {
        pushKeys({
          library: "vue-i18n",
          confidence: relevant ? 0.85 : 0.75,
          context: "member-call",
          evidence: "vue-i18n-detector: $t(...)",
        });
        return;
      }

      if (endsWithProperty(node.expression, "t")) {
        const root = rootIdentifier(node.expression);
        if (
          root &&
          (root === "i18n" || bindings.i18nObjects.has(root)) &&
          // Avoid stealing i18next i18n.t when both present — prefer vue only if vue imported
          (fileImportsLibrary(bindings, VUE_I18N_MODULES) ||
            !fileImportsLibrary(bindings, new Set(["i18next", "react-i18next"])))
        ) {
          pushKeys({
            library: "vue-i18n",
            confidence: 0.88,
            context: "member-call",
            evidence: `vue-i18n-detector: ${root}.….t(...)`,
          });
        }
      }
    });

    return usages;
  },
};

function hasNuxtI18nHint(hints: ReadonlySet<string>): boolean {
  for (const h of hints) {
    const id = h.toLowerCase();
    if (
      id === "nuxt-i18n" ||
      id === "@nuxtjs/i18n" ||
      (id.includes("nuxt") && id.includes("i18n"))
    ) {
      return true;
    }
  }
  return false;
}
