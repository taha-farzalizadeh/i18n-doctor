import { traversalApi } from "@i18n-doctor/ast";
import ts from "typescript";
import type { LibraryUsageDetector, TranslationUsage } from "../../api/types.js";
import { staticStringKey } from "../ast-helpers.js";
import {
  fileImportsLibrary,
  NGX_MODULES,
  TRANSLOCO_MODULES,
} from "../bindings.js";
import { locationOf } from "../location.js";
import { buildUsage } from "../usage-builder.js";

const METHODS = new Set([
  "instant",
  "get",
  "translate",
  "selectTranslate",
]);

/**
 * Angular ngx-translate / Transloco (script):
 * - translate.instant("key")
 * - this.translate.instant("key")
 */
export const angularUsageDetector: LibraryUsageDetector = {
  id: "ngx-translate",
  detect(input) {
    const usages: TranslationUsage[] = [];
    const { sourceFile, bindings, absolutePath, relativePath } = input;
    const ngx = fileImportsLibrary(bindings, NGX_MODULES);
    const transloco = fileImportsLibrary(bindings, TRANSLOCO_MODULES);
    const relevant =
      ngx || transloco || bindings.translateServices.size > 0;

    if (!relevant) {
      return usages;
    }

    const serviceNames = new Set(bindings.translateServices);
    serviceNames.add("translate");
    serviceNames.add("transloco");

    traversalApi.forEachChild(sourceFile, (node) => {
      if (!ts.isCallExpression(node) || node.arguments.length === 0) {
        return;
      }
      if (!ts.isPropertyAccessExpression(node.expression)) {
        return;
      }
      const method = ts.isIdentifier(node.expression.name)
        ? node.expression.name.text
        : undefined;
      if (!method || !METHODS.has(method)) {
        return;
      }

      const objectName = resolveServiceObjectName(node.expression.expression);
      if (!objectName || !serviceNames.has(objectName)) {
        return;
      }

      const keyNode = node.arguments[0];
      const key = staticStringKey(keyNode);
      if (key === undefined || !keyNode) {
        return;
      }

      usages.push(
        buildUsage({
          key,
          absolutePath,
          relativePath,
          location: locationOf(sourceFile, keyNode),
          library: transloco && !ngx ? "transloco" : "ngx-translate",
          confidence: 0.88,
          context: "method-call",
          evidence: `angular-detector: ${objectName}.${method}(...)`,
        }),
      );
    });

    return usages;
  },
};

function resolveServiceObjectName(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr)) {
    return expr.text;
  }
  // this.translate
  if (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.name)
  ) {
    return expr.name.text;
  }
  return undefined;
}
