import { traversalApi } from "@i18n-doctor/ast";
import ts from "typescript";
import type { LibraryUsageDetector, TranslationUsage } from "../../api/types.js";
import {
  calleeIdentifier,
  idFromObjectLiteral,
  jsxAttributeValue,
  jsxTagName,
  memberAccess,
  staticStringKey,
} from "../ast-helpers.js";
import {
  fileImportsLibrary,
  isIntlObject,
  REACT_INTL_MODULES,
} from "../bindings.js";
import { locationOf } from "../location.js";
import { buildUsage } from "../usage-builder.js";

/**
 * react-intl / FormatJS:
 * - formatMessage({ id: "key" })
 * - intl.formatMessage({ id: "key" })
 * - <FormattedMessage id="key" />
 */
export const reactIntlUsageDetector: LibraryUsageDetector = {
  id: "react-intl",
  detect(input) {
    const usages: TranslationUsage[] = [];
    const { sourceFile, bindings, absolutePath, relativePath } = input;
    const relevant =
      bindings.hooks.useIntl ||
      bindings.formatMessageNames.size > 0 ||
      fileImportsLibrary(bindings, REACT_INTL_MODULES);

    if (!relevant) {
      return usages;
    }

    traversalApi.forEachChild(sourceFile, (node) => {
      if (ts.isCallExpression(node) && node.arguments.length > 0) {
        const ident = calleeIdentifier(node.expression);
        const member = memberAccess(node.expression);
        const isFormatMessage =
          (ident !== undefined && bindings.formatMessageNames.has(ident)) ||
          (ident === "formatMessage" &&
            (bindings.hooks.useIntl ||
              bindings.formatMessageNames.has("formatMessage"))) ||
          (member !== undefined &&
            member.property === "formatMessage" &&
            isIntlObject(bindings, member.object));

        if (isFormatMessage) {
          const fromObj = idFromObjectLiteral(node.arguments[0], sourceFile);
          if (fromObj) {
            usages.push(
              buildUsage({
                key: fromObj.key,
                absolutePath,
                relativePath,
                location: locationOf(sourceFile, fromObj.node),
                library: "react-intl",
                confidence: 0.9,
                context: "function-call",
                evidence: "react-intl-detector: formatMessage({ id })",
              }),
            );
            return;
          }
          const keyNode = node.arguments[0];
          const key = staticStringKey(keyNode, sourceFile);
          if (key !== undefined && keyNode) {
            usages.push(
              buildUsage({
                key,
                absolutePath,
                relativePath,
                location: locationOf(sourceFile, keyNode),
                library: "react-intl",
                confidence: 0.7,
                context: "function-call",
                evidence: "react-intl-detector: formatMessage(string)",
              }),
            );
          }
        }
      }

      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const tag = jsxTagName(node);
        const base = tag.includes(".") ? tag.slice(tag.lastIndexOf(".") + 1) : tag;
        if (base === "FormattedMessage") {
          const attr = jsxAttributeValue(node, "id", sourceFile);
          if (attr) {
            usages.push(
              buildUsage({
                key: attr.key,
                absolutePath,
                relativePath,
                location: locationOf(sourceFile, attr.node),
                library: "react-intl",
                confidence: 0.92,
                context: "jsx-attribute",
                evidence: "react-intl-detector: <FormattedMessage id>",
              }),
            );
          }
        }
      }
    });

    return usages;
  },
};
