import { traversalApi } from "@i18n-doctor/ast";
import ts from "typescript";
import type {
  LibraryUsageDetector,
  TFunctionBinding,
  TranslationUsage,
} from "../../api/types.js";
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
  staticCallOptionsNs,
} from "../bindings.js";
import { locationOf } from "../location.js";
import { buildUsage } from "../usage-builder.js";

/**
 * i18next / react-i18next / next-i18next:
 * - t("key") when t is file-locally bound from useTranslation
 * - t("key", { ns: "settings" })
 * - useTranslation(["home","settings"]) multi-namespace
 * - const api = useTranslation("home"); api.t("key")
 * - i18n.t("key") / i18next.t("key") / i18n.t("ns:key")
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
      bindings.translationObjects.size > 0 ||
      fileImportsLibrary(bindings, I18NEXT_MODULES);

    if (!relevant) {
      return usages;
    }

    traversalApi.forEachChild(sourceFile, (node) => {
      if (!ts.isCallExpression(node) || node.arguments.length === 0) {
        return;
      }

      const keyNode = node.arguments[0];
      const key = staticStringKey(keyNode, sourceFile);
      if (key === undefined || !keyNode) {
        return;
      }

      const optionsNs = staticCallOptionsNs(node.arguments[1]);
      const library = fileImportsLibrary(bindings, new Set(["react-i18next"]))
        ? "react-i18next"
        : fileImportsLibrary(bindings, new Set(["next-i18next"]))
          ? "next-i18next"
          : "i18next";

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
          (bindings.i18nObjects.has(alias.member.object) ||
            bindings.translationObjects.has(alias.member.object))
        ) {
          const objectBinding = bindings.translationObjects.get(
            alias.member.object,
          );
          const nsFields = resolveUsageNamespaces(
            key,
            optionsNs,
            objectBinding,
          );
          usages.push(
            buildUsage({
              key: nsFields.key,
              absolutePath,
              relativePath,
              location: locationOf(sourceFile, keyNode),
              library,
              ...nsFields.fields,
              confidence: Math.min(
                objectBinding?.confidence ?? 0.88,
                alias.resolution.confidence,
                nsFields.namespaceResolved ? 0.92 : 0.4,
              ),
              context: "function-call",
              evidence: `i18next-detector: ${alias.aliasEvidence ?? `${alias.member.object}.t`}${nsFields.evidenceSuffix}`,
            }),
          );
          return;
        }

        const binding = alias.binding;
        if (binding && isI18nextFamily(binding.library)) {
          const nsFields = resolveUsageNamespaces(key, optionsNs, binding);
          usages.push(
            buildUsage({
              key: nsFields.key,
              absolutePath,
              relativePath,
              location: locationOf(sourceFile, keyNode),
              library: binding.library,
              ...nsFields.fields,
              confidence: Math.min(
                binding.confidence,
                alias.resolution.confidence,
                nsFields.namespaceResolved ? 1 : 0.4,
              ),
              context: "function-call",
              evidence: `i18next-detector: ${binding.origin}${
                alias.aliasEvidence ? ` (${alias.aliasEvidence})` : ""
              }${nsFields.evidenceSuffix}`,
            }),
          );
          return;
        }
      }

      if (endsWithProperty(node.expression, "t")) {
        const root = rootIdentifier(node.expression);
        if (
          root &&
          (bindings.i18nObjects.has(root) ||
            bindings.translationObjects.has(root))
        ) {
          const objectBinding = bindings.translationObjects.get(root);
          const nsFields = resolveUsageNamespaces(
            key,
            optionsNs,
            objectBinding,
          );
          usages.push(
            buildUsage({
              key: nsFields.key,
              absolutePath,
              relativePath,
              location: locationOf(sourceFile, keyNode),
              library,
              ...nsFields.fields,
              confidence: Math.min(
                0.88,
                nsFields.namespaceResolved ? 0.88 : 0.4,
              ),
              context: "member-call",
              evidence: `i18next-detector: ${root}.….t(...)${nsFields.evidenceSuffix}`,
            }),
          );
        }
      }
    });

    return usages;
  },
};

function resolveUsageNamespaces(
  key: string,
  optionsNs: { namespace?: string; namespaces?: readonly string[] },
  binding: TFunctionBinding | undefined,
): {
  key: string;
  fields: {
    namespace?: string;
    namespaces?: readonly string[];
    namespaceResolved: boolean;
  };
  evidenceSuffix: string;
  namespaceResolved: boolean;
} {
  const withPrefix = (rawKey: string): string =>
    binding?.keyPrefix ? `${binding.keyPrefix}.${rawKey}` : rawKey;

  // Priority: options.ns > binding ns > inline "ns:key"
  if (optionsNs.namespace) {
    return {
      key: withPrefix(key),
      fields: {
        namespace: optionsNs.namespace,
        ...(optionsNs.namespaces
          ? { namespaces: optionsNs.namespaces }
          : {}),
        namespaceResolved: true,
      },
      evidenceSuffix: ` ns=${optionsNs.namespace} (options)`,
      namespaceResolved: true,
    };
  }

  if (binding?.namespace) {
    const namespaces =
      binding.namespaces && binding.namespaces.length > 1
        ? binding.namespaces
        : undefined;
    return {
      key: withPrefix(key),
      fields: {
        namespace: binding.namespace,
        ...(namespaces ? { namespaces } : {}),
        namespaceResolved: true,
      },
      evidenceSuffix: ` ns=${binding.namespace}${
        binding.keyPrefix ? ` keyPrefix=${binding.keyPrefix}` : ""
      }`,
      namespaceResolved: true,
    };
  }

  const inline = splitInlineNs(key);
  if (inline) {
    return {
      key: inline.key,
      fields: {
        namespace: inline.namespace,
        namespaceResolved: true,
      },
      evidenceSuffix: ` ns=${inline.namespace} (inline)`,
      namespaceResolved: true,
    };
  }

  return {
    key,
    fields: { namespaceResolved: false },
    evidenceSuffix: " (namespace unresolved)",
    namespaceResolved: false,
  };
}

function splitInlineNs(
  key: string,
): { namespace: string; key: string } | undefined {
  const idx = key.indexOf(":");
  if (idx <= 0 || idx === key.length - 1) {
    return undefined;
  }
  // Avoid treating URLs / times as ns:key
  if (key.includes("://") || /^\d+:\d+/.test(key)) {
    return undefined;
  }
  return {
    namespace: key.slice(0, idx),
    key: key.slice(idx + 1),
  };
}
