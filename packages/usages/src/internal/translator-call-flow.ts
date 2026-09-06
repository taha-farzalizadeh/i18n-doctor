/**
 * Cross-file namespace flow for translator parameters:
 *   export const usersColumns = (t: TFunction) => [{ headerName: t("USER_NAME") }]
 *   // caller:
 *   const { t } = useTranslation("usersManagement");
 *   usersColumns(t);
 *
 * Without this, `t("USER_NAME")` is detected but namespace-unresolved, so
 * namespaced catalogs report a false missing-key.
 */

import ts from "typescript";
import type { FileBindingTable } from "../api/types.js";
import { resolveTFunction } from "./bindings.js";
import { indexKey } from "./object-array-props.js";

export type TranslatorCallableIndex = Map<
  string,
  { paramIndex: number; paramName: string }
>;

/** `fileRel#exportName` → namespaces observed at call sites. */
export type TranslatorCallSiteNamespaces = Map<string, readonly string[]>;

/**
 * Index top-level / exported functions whose first translator-like parameter
 * is named `t` / `tx` / `translate` (typed or not when name matches).
 */
export function indexTranslatorCallables(
  sourceFile: ts.SourceFile,
  relativePath: string,
): TranslatorCallableIndex {
  const out: TranslatorCallableIndex = new Map();
  const fileRel = normalizeRel(relativePath);

  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      const info = translatorParamInfo(stmt);
      if (info) out.set(indexKey(fileRel, stmt.name.text), info);
      continue;
    }
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      const name = decl.name.text;
      const fromInit = decl.initializer
        ? translatorParamInfoFromExpression(decl.initializer)
        : undefined;
      const fromType = decl.type
        ? translatorParamInfoFromType(decl.type)
        : undefined;
      const info = fromInit ?? fromType;
      if (info) out.set(indexKey(fileRel, name), info);
    }
  }

  return out;
}

/**
 * Collect namespaces passed into indexed translator callables from this file.
 */
export function collectTranslatorCallSiteNamespaces(
  sourceFile: ts.SourceFile,
  relativePath: string,
  bindings: FileBindingTable,
  index: TranslatorCallableIndex,
): TranslatorCallSiteNamespaces {
  const out: TranslatorCallSiteNamespaces = new Map();
  if (index.size === 0) return out;

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression) {
      const callee = unwrap(node.expression);
      if (ts.isIdentifier(callee) && node.arguments.length > 0) {
        const targetKeys = resolveCallableKeys(
          callee.text,
          sourceFile,
          relativePath,
          index,
        );
        for (const key of targetKeys) {
          const info = index.get(key);
          if (!info) continue;
          const arg = node.arguments[info.paramIndex];
          if (!arg || !ts.isIdentifier(arg)) continue;
          const binding = resolveTFunction(
            bindings,
            arg.text,
            arg.getStart(sourceFile),
          );
          if (!binding?.namespace && !binding?.namespaces?.length) continue;
          mergeNamespaces(out, key, bindingNamespaces(binding));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
}

export function mergeTranslatorCallSiteNamespaces(
  target: TranslatorCallSiteNamespaces,
  source: TranslatorCallSiteNamespaces,
): void {
  for (const [key, namespaces] of source) {
    mergeNamespaces(target, key, namespaces);
  }
}

export function namespacesForLocalCallable(
  relativePath: string,
  name: string,
  callSites: TranslatorCallSiteNamespaces,
): readonly string[] | undefined {
  return callSites.get(indexKey(normalizeRel(relativePath), name));
}

function bindingNamespaces(binding: {
  namespace?: string;
  namespaces?: readonly string[];
}): readonly string[] {
  const out: string[] = [];
  if (binding.namespaces) {
    for (const ns of binding.namespaces) {
      if (!out.includes(ns)) out.push(ns);
    }
  }
  if (binding.namespace && !out.includes(binding.namespace)) {
    out.unshift(binding.namespace);
  }
  return out;
}

function mergeNamespaces(
  target: TranslatorCallSiteNamespaces,
  key: string,
  namespaces: readonly string[],
): void {
  if (namespaces.length === 0) return;
  const prev = target.get(key) ?? [];
  const merged = [...prev];
  for (const ns of namespaces) {
    if (!merged.includes(ns)) merged.push(ns);
  }
  target.set(key, merged);
}

function translatorParamInfo(
  fn: ts.SignatureDeclaration,
): { paramIndex: number; paramName: string } | undefined {
  for (let i = 0; i < fn.parameters.length; i += 1) {
    const param = fn.parameters[i]!;
    if (!ts.isIdentifier(param.name)) continue;
    const name = param.name.text;
    if (!TRANSLATOR_NAMES.has(name)) continue;
    if (param.type && !looksLikeTranslatorType(param.type)) continue;
    // Untyped `t` still counts — call-site flow is what supplies the namespace.
    return { paramIndex: i, paramName: name };
  }
  return undefined;
}

function translatorParamInfoFromExpression(
  expr: ts.Expression,
): { paramIndex: number; paramName: string } | undefined {
  const node = unwrap(expr);
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    return translatorParamInfo(node);
  }
  return undefined;
}

function translatorParamInfoFromType(
  type: ts.TypeNode,
): { paramIndex: number; paramName: string } | undefined {
  let current: ts.TypeNode = type;
  while (ts.isParenthesizedTypeNode(current)) {
    current = current.type;
  }
  if (ts.isFunctionTypeNode(current)) {
    return translatorParamInfo(current);
  }
  return undefined;
}

function looksLikeTranslatorType(type: ts.TypeNode): boolean {
  const text = type.getText();
  return /TFunction|TranslateFunction|Translator|i18n\.TFunction|\(\s*key/i.test(
    text,
  );
}

const TRANSLATOR_NAMES = new Set(["t", "tx", "translate"]);

function resolveCallableKeys(
  localName: string,
  sourceFile: ts.SourceFile,
  relativePath: string,
  index: TranslatorCallableIndex,
): readonly string[] {
  const localKey = indexKey(normalizeRel(relativePath), localName);
  if (index.has(localKey)) return [localKey];

  const modulePath = findImportModulePath(localName, sourceFile);
  if (!modulePath) return [];
  const targetRel = resolveRelativeModule(relativePath, modulePath);
  if (!targetRel) return [];

  const keys: string[] = [];
  for (const candidate of moduleCandidates(targetRel)) {
    const key = indexKey(candidate, localName);
    if (index.has(key)) keys.push(key);
  }
  return keys;
}

function findImportModulePath(
  localName: string,
  sourceFile: ts.SourceFile,
): string | undefined {
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const named = stmt.importClause.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) {
        if (el.name.text === localName) {
          return stmt.moduleSpecifier.text;
        }
      }
    }
  }
  return undefined;
}

function resolveRelativeModule(
  fromFile: string,
  moduleSpec: string,
): string | undefined {
  if (!moduleSpec.startsWith(".")) return undefined;
  const fromDir = fromFile.includes("/")
    ? fromFile.slice(0, fromFile.lastIndexOf("/"))
    : "";
  const joined = fromDir ? `${fromDir}/${moduleSpec}` : moduleSpec;
  return normalizeRel(joined);
}

function moduleCandidates(base: string): readonly string[] {
  const normalized = normalizeRel(base);
  if (/\.[cm]?[jt]sx?$/.test(normalized)) return [normalized];
  return [
    `${normalized}.ts`,
    `${normalized}.tsx`,
    `${normalized}.js`,
    `${normalized}.jsx`,
    `${normalized}.mjs`,
    `${normalized}.cjs`,
    `${normalized}/index.ts`,
    `${normalized}/index.tsx`,
    `${normalized}/index.js`,
  ];
}

function unwrap(expr: ts.Expression): ts.Expression {
  let current = expr;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function normalizeRel(rel: string): string {
  const parts: string[] = [];
  for (const part of rel.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}
