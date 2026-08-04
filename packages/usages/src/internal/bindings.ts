import { traversalApi } from "@i18n-unused/ast";
import ts from "typescript";
import type {
  FileBindingTable,
  TFunctionBinding,
  UsageLibraryId,
} from "../api/types.js";
import { enclosingScopeEnd } from "./ast-helpers.js";

const I18NEXT_MODULES = new Set([
  "i18next",
  "react-i18next",
  "next-i18next",
]);
const NEXT_INTL_MODULES = new Set(["next-intl", "next-intl/server", "use-intl"]);
const REACT_INTL_MODULES = new Set(["react-intl", "@formatjs/intl"]);
const LINGUI_MODULES = new Set([
  "@lingui/core",
  "@lingui/react",
  "@lingui/macro",
  "@lingui/core/macro",
  "@lingui/react/macro",
]);
const VUE_I18N_MODULES = new Set(["vue-i18n"]);
const NGX_MODULES = new Set(["@ngx-translate/core"]);
const TRANSLOCO_MODULES = new Set([
  "@jsverse/transloco",
  "@ngneat/transloco",
]);

interface ScopedTBinding extends TFunctionBinding {
  readonly name: string;
  readonly declPos: number;
  readonly scopeEnd: number;
}

const scopedT = new WeakMap<FileBindingTable, readonly ScopedTBinding[]>();
const intlObjects = new WeakMap<FileBindingTable, ReadonlySet<string>>();

/** Resolve file-local t-function binding at a call position (innermost scope). */
export function resolveTFunction(
  bindings: FileBindingTable,
  name: string,
  position: number,
): TFunctionBinding | undefined {
  const scopes = scopedT.get(bindings);
  if (!scopes) {
    return bindings.tFunctions.get(name);
  }
  let best: ScopedTBinding | undefined;
  for (const entry of scopes) {
    if (entry.name !== name) {
      continue;
    }
    if (position < entry.declPos || position > entry.scopeEnd) {
      continue;
    }
    if (!best || entry.declPos >= best.declPos) {
      best = entry;
    }
  }
  return best ?? bindings.tFunctions.get(name);
}

export function isIntlObject(
  bindings: FileBindingTable,
  name: string,
): boolean {
  return intlObjects.get(bindings)?.has(name) ?? name === "intl";
}

/**
 * Build a file-local binding table.
 * Tracks destructuring aliases from hooks in this file only — no cross-file resolve.
 */
export function buildFileBindings(
  sourceFile: ts.SourceFile,
): FileBindingTable {
  const tFunctions = new Map<string, TFunctionBinding>();
  const formatMessageNames = new Set<string>();
  const i18nObjects = new Set<string>();
  const translationObjects = new Map<string, TFunctionBinding>();
  const translateServices = new Set<string>();
  const importSpecifiers = new Set<string>();
  const intlObjectNames = new Set<string>(["intl"]);
  const scoped: ScopedTBinding[] = [];
  const hooks = {
    useTranslation: false,
    useTranslations: false,
    useIntl: false,
  };

  let hasI18nextImport = false;
  let hasVueI18nImport = false;

  traversalApi.forEachChild(sourceFile, (node) => {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) {
      return;
    }
    const spec = node.moduleSpecifier.text;
    importSpecifiers.add(spec);

    if (I18NEXT_MODULES.has(spec) || spec === "i18next" || spec.startsWith("i18next/")) {
      hasI18nextImport = true;
    }
    if (VUE_I18N_MODULES.has(spec) || spec.startsWith("vue-i18n/")) {
      hasVueI18nImport = true;
    }

    const clause = node.importClause;
    if (!clause) {
      return;
    }
    if (clause.name && (I18NEXT_MODULES.has(spec) || spec === "i18next")) {
      i18nObjects.add(clause.name.text);
    }
    if (clause.name && REACT_INTL_MODULES.has(spec)) {
      // default import uncommon
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) {
        const imported = (el.propertyName ?? el.name).text;
        const local = el.name.text;
        if (imported === "i18n" || imported === "i18next") {
          i18nObjects.add(local);
        }
        if (imported === "t" && (LINGUI_MODULES.has(spec) || I18NEXT_MODULES.has(spec))) {
          registerT(local, {
            library: LINGUI_MODULES.has(spec) ? "lingui" : libraryFromSpecifier(spec),
            confidence: 0.75,
            origin: `import { ${imported} as ${local} } from '${spec}'`,
          }, el, tFunctions, scoped);
        }
        if (imported === "msg" && LINGUI_MODULES.has(spec)) {
          registerT(local, {
            library: "lingui",
            confidence: 0.8,
            origin: `import { msg as ${local} } from '${spec}'`,
          }, el, tFunctions, scoped);
        }
      }
    }
  });

  if (hasI18nextImport) {
    i18nObjects.add("i18n");
    i18nObjects.add("i18next");
  }
  if (hasVueI18nImport) {
    i18nObjects.add("i18n");
  }

  traversalApi.forEachChild(sourceFile, (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer && node.name) {
      const init = unwrap(node.initializer);
      if (ts.isCallExpression(init)) {
        const callee = calleeName(init.expression);
        if (callee === "useTranslation") {
          hooks.useTranslation = true;
          const nsList = staticNamespaceArg(init.arguments[0]);
          const opts = staticOptionsBag(init.arguments[1]);
          const binding: TFunctionBinding = {
            library: pickI18nextLibrary(importSpecifiers),
            ...(nsList?.[0] !== undefined ? { namespace: nsList[0] } : {}),
            ...(nsList && nsList.length > 1 ? { namespaces: nsList } : {}),
            ...(opts.keyPrefix !== undefined
              ? { keyPrefix: opts.keyPrefix }
              : {}),
            confidence: nsList ? 0.9 : 0.75,
            origin: nsList
              ? `useTranslation(${JSON.stringify(nsList.length === 1 ? nsList[0] : nsList)})`
              : "useTranslation()",
          };
          bindDestructuredT(node.name, binding, tFunctions, scoped);
          if (ts.isIdentifier(node.name)) {
            translationObjects.set(node.name.text, binding);
          }
        }
        if (callee === "useTranslations") {
          hooks.useTranslations = true;
          const ns = staticStringArg(init.arguments[0]);
          const opts = staticOptionsBag(init.arguments[1]);
          const binding: TFunctionBinding = {
            library: "next-intl",
            ...(ns !== undefined ? { namespace: ns } : {}),
            ...(opts.keyPrefix !== undefined
              ? { keyPrefix: opts.keyPrefix }
              : {}),
            confidence: 0.92,
            origin: "useTranslations()",
          };
          if (ts.isIdentifier(node.name)) {
            registerT(node.name.text, binding, node, tFunctions, scoped);
            translationObjects.set(node.name.text, binding);
          }
          bindDestructuredT(node.name, binding, tFunctions, scoped);
        }
        if (callee === "useIntl") {
          hooks.useIntl = true;
          if (ts.isIdentifier(node.name)) {
            intlObjectNames.add(node.name.text);
          }
          bindFormatMessage(node.name, formatMessageNames);
        }
        if (callee === "useI18n") {
          const binding: TFunctionBinding = {
            library: "vue-i18n",
            confidence: 0.9,
            origin: "useI18n()",
          };
          bindDestructuredT(node.name, binding, tFunctions, scoped);
        }
        if (callee === "createI18n" && ts.isIdentifier(node.name)) {
          i18nObjects.add(node.name.text);
        }
      }

      if (
        ts.isIdentifier(node.name) &&
        ts.isCallExpression(init) &&
        calleeName(init.expression) === "inject"
      ) {
        const typeArg = init.typeArguments?.[0];
        if (
          typeArg &&
          ts.isTypeReferenceNode(typeArg) &&
          ts.isIdentifier(typeArg.typeName)
        ) {
          if (
            typeArg.typeName.text === "TranslateService" ||
            typeArg.typeName.text === "TranslocoService"
          ) {
            translateServices.add(node.name.text);
          }
        }
      }
    }

    if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      const type = node.type;
      if (
        type &&
        ts.isTypeReferenceNode(type) &&
        ts.isIdentifier(type.typeName)
      ) {
        if (
          type.typeName.text === "TranslateService" ||
          type.typeName.text === "TranslocoService"
        ) {
          translateServices.add(node.name.text);
        }
      }
    }
  });

  // Implicit bare `t` only when useTranslation is present AND react-i18next/i18next imported.
  if (
    hooks.useTranslation &&
    !tFunctions.has("t") &&
    hasI18nextImport
  ) {
    const binding: TFunctionBinding = {
      library: pickI18nextLibrary(importSpecifiers),
      confidence: 0.5,
      origin: "useTranslation() in file (implicit t)",
    };
    tFunctions.set("t", binding);
    scoped.push({
      name: "t",
      ...binding,
      declPos: 0,
      scopeEnd: sourceFile.end,
    });
  }

  const table: FileBindingTable = {
    tFunctions,
    formatMessageNames,
    i18nObjects,
    translationObjects,
    translateServices,
    hooks,
    importSpecifiers,
  };
  scopedT.set(table, scoped);
  intlObjects.set(table, intlObjectNames);
  return table;
}

function registerT(
  name: string,
  binding: TFunctionBinding,
  at: ts.Node,
  tFunctions: Map<string, TFunctionBinding>,
  scoped: ScopedTBinding[],
): void {
  tFunctions.set(name, binding);
  scoped.push({
    name,
    ...binding,
    declPos: at.getStart(),
    scopeEnd: enclosingScopeEnd(at),
  });
}

function bindDestructuredT(
  name: ts.BindingName,
  binding: TFunctionBinding,
  tFunctions: Map<string, TFunctionBinding>,
  scoped: ScopedTBinding[],
): void {
  if (!ts.isObjectBindingPattern(name)) {
    return;
  }
  for (const element of name.elements) {
    if (!ts.isBindingElement(element) || element.dotDotDotToken) {
      continue;
    }
    const prop = element.propertyName
      ? propertyNameText(element.propertyName)
      : ts.isIdentifier(element.name)
        ? element.name.text
        : undefined;
    const local = ts.isIdentifier(element.name) ? element.name.text : undefined;
    if ((prop === "t" || prop === "tx") && local) {
      registerT(
        local,
        {
          ...binding,
          origin: `${binding.origin} → { ${prop}: ${local} }`,
        },
        element,
        tFunctions,
        scoped,
      );
    }
  }
}

function bindFormatMessage(
  name: ts.BindingName,
  formatMessageNames: Set<string>,
): void {
  if (!ts.isObjectBindingPattern(name)) {
    return;
  }
  for (const element of name.elements) {
    if (!ts.isBindingElement(element)) {
      continue;
    }
    const prop = element.propertyName
      ? propertyNameText(element.propertyName)
      : ts.isIdentifier(element.name)
        ? element.name.text
        : undefined;
    const local = ts.isIdentifier(element.name) ? element.name.text : undefined;
    if (prop === "formatMessage" && local) {
      formatMessageNames.add(local);
    }
  }
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function unwrap(expr: ts.Expression): ts.Expression {
  if (
    ts.isAsExpression(expr) ||
    ts.isSatisfiesExpression(expr) ||
    ts.isParenthesizedExpression(expr)
  ) {
    return unwrap(expr.expression);
  }
  return expr;
}

function calleeName(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr)) {
    return expr.text;
  }
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) {
    return expr.name.text;
  }
  return undefined;
}

function staticStringArg(arg: ts.Expression | undefined): string | undefined {
  if (!arg) {
    return undefined;
  }
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
    return arg.text;
  }
  return undefined;
}

/** useTranslation("home") | useTranslation(["home","settings"]) */
function staticNamespaceArg(
  arg: ts.Expression | undefined,
): string[] | undefined {
  const single = staticStringArg(arg);
  if (single !== undefined) {
    return [single];
  }
  if (!arg || !ts.isArrayLiteralExpression(arg)) {
    return undefined;
  }
  const values: string[] = [];
  for (const el of arg.elements) {
    const text = staticStringArg(el);
    if (text === undefined) {
      return undefined;
    }
    values.push(text);
  }
  return values.length > 0 ? values : undefined;
}

function staticOptionsBag(arg: ts.Expression | undefined): {
  ns?: string | readonly string[];
  keyPrefix?: string;
} {
  if (!arg || !ts.isObjectLiteralExpression(arg)) {
    return {};
  }
  let ns: string | readonly string[] | undefined;
  let keyPrefix: string | undefined;
  for (const prop of arg.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      continue;
    }
    const name = propertyNameText(prop.name);
    if (name === "ns") {
      const list = staticNamespaceArg(prop.initializer);
      if (list) {
        ns = list.length === 1 ? list[0] : list;
      }
    }
    if (name === "keyPrefix") {
      keyPrefix = staticStringArg(prop.initializer);
    }
  }
  return {
    ...(ns !== undefined ? { ns } : {}),
    ...(keyPrefix !== undefined ? { keyPrefix } : {}),
  };
}

/** Parse t(key, { ns }) options at a call site. */
export function staticCallOptionsNs(
  arg: ts.Expression | undefined,
): { namespace?: string; namespaces?: readonly string[] } {
  const opts = staticOptionsBag(arg);
  if (opts.ns === undefined) {
    return {};
  }
  if (typeof opts.ns === "string") {
    return { namespace: opts.ns };
  }
  const primary = opts.ns[0];
  if (primary === undefined) {
    return {};
  }
  return {
    namespace: primary,
    ...(opts.ns.length > 1 ? { namespaces: opts.ns } : {}),
  };
}

function libraryFromSpecifier(spec: string): UsageLibraryId {
  if (spec.includes("next-i18next")) {
    return "next-i18next";
  }
  if (spec.includes("react-i18next")) {
    return "react-i18next";
  }
  if (spec.includes("i18next")) {
    return "i18next";
  }
  return "unknown";
}

function pickI18nextLibrary(imports: ReadonlySet<string>): UsageLibraryId {
  if ([...imports].some((s) => s.includes("next-i18next"))) {
    return "next-i18next";
  }
  if ([...imports].some((s) => s.includes("react-i18next"))) {
    return "react-i18next";
  }
  if ([...imports].some((s) => s === "i18next" || s.startsWith("i18next/"))) {
    return "i18next";
  }
  return "react-i18next";
}

export function fileImportsLibrary(
  bindings: FileBindingTable,
  modules: ReadonlySet<string>,
): boolean {
  for (const spec of bindings.importSpecifiers) {
    if (modules.has(spec)) {
      return true;
    }
    for (const mod of modules) {
      if (spec === mod || spec.startsWith(`${mod}/`)) {
        return true;
      }
    }
  }
  return false;
}

export function isI18nextFamily(library: UsageLibraryId): boolean {
  return (
    library === "i18next" ||
    library === "react-i18next" ||
    library === "next-i18next"
  );
}

export {
  I18NEXT_MODULES,
  NEXT_INTL_MODULES,
  REACT_INTL_MODULES,
  LINGUI_MODULES,
  VUE_I18N_MODULES,
  NGX_MODULES,
  TRANSLOCO_MODULES,
};
