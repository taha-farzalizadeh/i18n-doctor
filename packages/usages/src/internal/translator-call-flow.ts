/**
 * Cross-file namespace flow for translator parameters:
 *   export const usersColumns = (t: TFunction) => [{ headerName: t("USER_NAME") }]
 *   // caller:
 *   const { t } = useTranslation("usersManagement");
 *   usersColumns(t);
 *
 * Also covers store/object methods (`odsDownload(uuid, t)`), path-alias imports,
 * and nested same-file factories (`schema(t)` → `dateSchema(t)`).
 */

import ts from "typescript";
import type { FileBindingTable } from "../api/types.js";
import { resolveTFunction } from "./bindings.js";
import {
  resolveImportedFileCandidates,
} from "./module-path.js";
import { indexKey } from "./object-array-props.js";

export type TranslatorCallableIndex = Map<
  string,
  { paramIndex: number; paramName: string }
>;

/** `fileRel#exportName` → namespaces observed at call sites. */
export type TranslatorCallSiteNamespaces = Map<string, readonly string[]>;

/**
 * Local binding / prop name → store action method names.
 *   const deleteRowRawById = useEtlStore(s => s.deleteRawRowById)
 * maps `deleteRowRawById` → `["deleteRawRowById"]` so call sites using the
 * renamed binding still enrich the real action.
 */
export type StoreSelectorAliasIndex = Map<string, readonly string[]>;

/**
 * Index top-level / exported functions and object methods whose translator-like
 * parameter is named `t` / `tx` / `translate`.
 */
export function indexTranslatorCallables(
  sourceFile: ts.SourceFile,
  relativePath: string,
): TranslatorCallableIndex {
  const out: TranslatorCallableIndex = new Map();
  const fileRel = normalizeRel(relativePath);

  const addFn = (
    name: string,
    fn: ts.SignatureDeclaration,
  ): void => {
    const info = translatorParamInfo(fn);
    if (info) out.set(indexKey(fileRel, name), info);
  };

  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      addFn(stmt.name.text, stmt);
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

      if (decl.initializer) {
        indexObjectMethodsWithTranslator(
          decl.initializer,
          fileRel,
          out,
        );
      }
    }
  }

  return out;
}

/**
 * Index Zustand-style renamed selectors:
 *   const deleteRowRawById = useEtlStore(state => state.deleteRawRowById)
 */
export function indexStoreSelectorAliases(
  sourceFile: ts.SourceFile,
): StoreSelectorAliasIndex {
  const out: StoreSelectorAliasIndex = new Map();

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const method = storeMethodFromSelector(node.initializer);
      if (method) {
        const local = node.name.text;
        const prev = out.get(local) ?? [];
        if (!prev.includes(method)) {
          out.set(local, [...prev, method]);
        }
      }
    }
    // const { deleteRawRowById: deleteRowRawById } = useStore(...)
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name)
    ) {
      for (const el of node.name.elements) {
        if (el.dotDotDotToken || !ts.isIdentifier(el.name)) continue;
        const local = el.name.text;
        const remote = el.propertyName
          ? propertyNameText(el.propertyName)
          : local;
        if (!remote || remote === local) continue;
        // Only treat as store alias when initializer looks like a store call,
        // or always map rename in object binding from any call — useful for
        // `const { deleteRawRowById: deleteRowRawById } = store.getState()`.
        if (node.initializer && looksLikeStoreAccess(node.initializer)) {
          const prev = out.get(local) ?? [];
          if (!prev.includes(remote)) out.set(local, [...prev, remote]);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
}

export function mergeStoreSelectorAliases(
  target: StoreSelectorAliasIndex,
  source: StoreSelectorAliasIndex,
): void {
  for (const [local, methods] of source) {
    const prev = target.get(local) ?? [];
    const merged = [...prev];
    for (const method of methods) {
      if (!merged.includes(method)) merged.push(method);
    }
    target.set(local, merged);
  }
}

/**
 * Collect namespaces passed into indexed translator callables from this file.
 */
export function collectTranslatorCallSiteNamespaces(
  sourceFile: ts.SourceFile,
  relativePath: string,
  bindings: FileBindingTable,
  index: TranslatorCallableIndex,
  aliases?: StoreSelectorAliasIndex,
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
          aliases,
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

/**
 * After call-site namespaces are known, propagate them into nested same-file
 * calls like `schema(t) { dateSchema(t) }` so nested factories resolve too.
 */
export function propagateNestedTranslatorCallSites(
  sourceFile: ts.SourceFile,
  relativePath: string,
  index: TranslatorCallableIndex,
  callSites: TranslatorCallSiteNamespaces,
): void {
  if (callSites.size === 0 || index.size === 0) return;
  const fileRel = normalizeRel(relativePath);
  const queue: string[] = [];
  for (const key of callSites.keys()) {
    if (key.startsWith(`${fileRel}#`)) queue.push(key);
  }

  const seen = new Set<string>();
  while (queue.length > 0) {
    const key = queue.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);

    const namespaces = callSites.get(key);
    if (!namespaces || namespaces.length === 0) continue;
    const name = key.slice(fileRel.length + 1);
    const body = findCallableBody(sourceFile, name);
    if (!body) continue;

    const info = index.get(key);
    const paramName = info?.paramName ?? "t";

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && node.expression) {
        const callee = unwrap(node.expression);
        if (ts.isIdentifier(callee) && node.arguments.length > 0) {
          const nestedKeys = resolveCallableKeys(
            callee.text,
            sourceFile,
            relativePath,
            index,
          ).filter((k) => k.startsWith(`${fileRel}#`));
          for (const nestedKey of nestedKeys) {
            const nestedInfo = index.get(nestedKey);
            if (!nestedInfo) continue;
            const arg = node.arguments[nestedInfo.paramIndex];
            if (!arg || !ts.isIdentifier(arg) || arg.text !== paramName) {
              continue;
            }
            const before = callSites.get(nestedKey)?.length ?? 0;
            mergeNamespaces(callSites, nestedKey, namespaces);
            if ((callSites.get(nestedKey)?.length ?? 0) > before) {
              queue.push(nestedKey);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(body);
  }
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

/**
 * Index methods/properties on returned object literals that take a translator
 * param (Zustand action bags, `tableTabsActions`, etc.).
 */
function indexObjectMethodsWithTranslator(
  expr: ts.Expression,
  fileRel: string,
  out: TranslatorCallableIndex,
): void {
  const node = unwrap(expr);
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const body = node.body;
    if (ts.isBlock(body)) {
      for (const stmt of body.statements) {
        if (!ts.isReturnStatement(stmt) || !stmt.expression) continue;
        indexObjectLiteralMethods(stmt.expression, fileRel, out);
      }
    } else {
      indexObjectLiteralMethods(body, fileRel, out);
    }
    return;
  }
  indexObjectLiteralMethods(node, fileRel, out);
}

function indexObjectLiteralMethods(
  expr: ts.Expression,
  fileRel: string,
  out: TranslatorCallableIndex,
): void {
  const node = unwrap(expr);
  if (!ts.isObjectLiteralExpression(node)) return;
  for (const prop of node.properties) {
    if (ts.isMethodDeclaration(prop) && prop.name && ts.isIdentifier(prop.name)) {
      const info = translatorParamInfo(prop);
      if (info) out.set(indexKey(fileRel, prop.name.text), info);
      continue;
    }
    if (
      ts.isPropertyAssignment(prop) &&
      prop.name &&
      ts.isIdentifier(prop.name)
    ) {
      const info = translatorParamInfoFromExpression(prop.initializer);
      if (info) out.set(indexKey(fileRel, prop.name.text), info);
      // Shorthand `{ addMapTab }` — resolved via top-level const index already.
    }
  }
}

function resolveCallableKeys(
  localName: string,
  sourceFile: ts.SourceFile,
  relativePath: string,
  index: TranslatorCallableIndex,
  aliases?: StoreSelectorAliasIndex,
): readonly string[] {
  const localKey = indexKey(normalizeRel(relativePath), localName);
  if (index.has(localKey)) return [localKey];

  const modulePath = findImportModulePath(localName, sourceFile);
  if (modulePath) {
    const keys: string[] = [];
    for (const candidate of resolveImportedFileCandidates(
      relativePath,
      modulePath,
    )) {
      const key = indexKey(candidate, localName);
      if (index.has(key)) keys.push(key);
    }
    if (keys.length > 0) return keys;
  }

  const namesToFind = new Set<string>([localName]);
  if (aliases) {
    for (const method of aliases.get(localName) ?? []) {
      namesToFind.add(method);
    }
  }

  // Store / destructured methods: `const { odsDownload } = useStore()` —
  // and renamed selectors: localName → real method via aliases.
  const fallback: string[] = [];
  for (const name of namesToFind) {
    const suffix = `#${name}`;
    for (const key of index.keys()) {
      if (key.endsWith(suffix) && !fallback.includes(key)) fallback.push(key);
    }
  }
  return fallback;
}

/**
 * `useEtlStore(state => state.deleteRawRowById)` → `"deleteRawRowById"`
 */
function storeMethodFromSelector(expr: ts.Expression): string | undefined {
  const call = unwrap(expr);
  if (!ts.isCallExpression(call) || call.arguments.length === 0) {
    return undefined;
  }
  if (!isStoreHookCallee(call.expression)) return undefined;
  const selector = unwrap(call.arguments[0]!);
  return methodFromSelectorFn(selector);
}

function isStoreHookCallee(expr: ts.Expression): boolean {
  const callee = unwrap(expr);
  if (ts.isIdentifier(callee)) {
    return /^use\w*Store$/i.test(callee.text) || /Store$/i.test(callee.text);
  }
  if (
    ts.isPropertyAccessExpression(callee) &&
    (callee.name.text === "getState" || callee.name.text === "subscribe")
  ) {
    return isStoreHookCallee(callee.expression);
  }
  return false;
}

function methodFromSelectorFn(expr: ts.Expression): string | undefined {
  if (!ts.isArrowFunction(expr) && !ts.isFunctionExpression(expr)) {
    return undefined;
  }
  const param = expr.parameters[0];
  if (!param || !ts.isIdentifier(param.name)) return undefined;
  const paramName = param.name.text;

  let body: ts.Expression | undefined;
  if (ts.isBlock(expr.body)) {
    for (const stmt of expr.body.statements) {
      if (ts.isReturnStatement(stmt) && stmt.expression) {
        body = stmt.expression;
        break;
      }
    }
  } else {
    body = expr.body;
  }
  if (!body) return undefined;
  const access = unwrap(body);
  if (
    ts.isPropertyAccessExpression(access) &&
    ts.isIdentifier(access.expression) &&
    access.expression.text === paramName &&
    ts.isIdentifier(access.name)
  ) {
    return access.name.text;
  }
  return undefined;
}

function looksLikeStoreAccess(expr: ts.Expression): boolean {
  const node = unwrap(expr);
  if (ts.isCallExpression(node)) {
    const callee = unwrap(node.expression);
    // useFooStore(...) / useFooStore.getState()
    if (ts.isIdentifier(callee) && /store/i.test(callee.text)) return true;
    if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.name) &&
      (callee.name.text === "getState" || /store/i.test(callee.name.text))
    ) {
      return true;
    }
    if (ts.isIdentifier(callee)) return true; // useX(...) selectors
  }
  return false;
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
    return name.text;
  }
  return undefined;
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

function findCallableBody(
  sourceFile: ts.SourceFile,
  name: string,
): ts.Node | undefined {
  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name && stmt.body) {
      return stmt.body;
    }
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text !== name) continue;
      if (!decl.initializer) continue;
      const init = unwrap(decl.initializer);
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        return init.body;
      }
      if (ts.isObjectLiteralExpression(init)) {
        return findMethodBodyInObject(init, name) ?? init;
      }
    }
  }

  // Method name indexed from inside a factory return — search object methods.
  const visit = (node: ts.Node): ts.Node | undefined => {
    if (ts.isObjectLiteralExpression(node)) {
      const body = findMethodBodyInObject(node, name);
      if (body) return body;
    }
    let found: ts.Node | undefined;
    ts.forEachChild(node, (child) => {
      if (found) return;
      found = visit(child);
    });
    return found;
  };
  return visit(sourceFile);
}

function findMethodBodyInObject(
  obj: ts.ObjectLiteralExpression,
  name: string,
): ts.Node | undefined {
  for (const prop of obj.properties) {
    if (
      ts.isMethodDeclaration(prop) &&
      prop.name &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === name &&
      prop.body
    ) {
      return prop.body;
    }
    if (
      ts.isPropertyAssignment(prop) &&
      prop.name &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === name
    ) {
      const init = unwrap(prop.initializer);
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        return init.body;
      }
    }
  }
  return undefined;
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
