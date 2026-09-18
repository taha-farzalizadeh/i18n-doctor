/**
 * Resolve translation keys from patterns like:
 *   fields.map((field) => t(field.label))
 * where `fields` is a static array of objects (or a function returning one),
 * including cross-file exports such as `userFormFields()`.
 *
 * Also covers state-backed maps fed by string enums:
 *   setItems([{ name: WpNavbar.SENSITIVE_TERMS }]);
 *   items.map((item) => t(item.name));
 *
 * Plus object-of-objects configs (`chartConfigs[id].title`), string maps
 * (`t(descriptions[item])`), route-param titles, and `Object.keys(Enum)`.
 * Also: factory configs (`t(toolboxIcons()[mode].tooltip)`), useMemo menus
 * (`t(menu.name)`), and remapped helper-array labels (`t(label)`).
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { StaticKeyOptions } from "./ast-helpers.js";
import { staticStringKeys } from "./ast-helpers.js";
import type { EnumValueIndex } from "./enum-values.js";
import { allStringEnumValues } from "./enum-values.js";
import type { HelperReturnIndex } from "./helper-returns.js";
import { resolveHelperCallKeys } from "./helper-returns.js";
import {
  getActiveRoot,
  resolveImportedFileCandidates,
} from "./module-path.js";

/** `fileRel#exportName` → property name → static string keys. */
export type ObjectArrayPropIndex = Map<
  string,
  ReadonlyMap<string, readonly string[]>
>;

/**
 * Prop names that commonly hold translation keys when used as `t(x.prop)` on
 * props/params. Broad names like `type` are excluded to avoid false missings
 * from `t(newValue.type)` pulling every indexed `type` string in the project.
 */
const WIDE_INDEX_PROPS = new Set([
  "translation",
  "title",
  "label",
  "labelKey",
  "name",
  "text",
  "headerName",
  "message",
  "placeholder",
  "description",
  "translateValue",
  "tooltip",
  "ariaLabel",
  "titleKey",
]);

export function indexKey(fileRel: string, name: string): string {
  return `${normalizeRel(fileRel)}#${name}`;
}

/**
 * Index top-level / exported consts and functions that yield arrays of objects
 * with static string properties (e.g. form field configs), or object-of-objects
 * configs (e.g. chartConfigs with `title` on each entry).
 */
export function indexObjectArrayProps(
  sourceFile: ts.SourceFile,
  relativePath: string,
  enumIndex?: EnumValueIndex,
): ObjectArrayPropIndex {
  const out: ObjectArrayPropIndex = new Map();
  const fileRel = normalizeRel(relativePath);
  const keyOpts = keyOptions(relativePath, enumIndex);

  for (const stmt of sourceFile.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const name = decl.name.text;
        const props = propsFromConfigExpression(
          decl.initializer,
          sourceFile,
          keyOpts,
        );
        if (props && props.size > 0) {
          out.set(indexKey(fileRel, name), props);
        }
      }
      continue;
    }

    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) {
      const array = objectArrayFromFunctionBody(stmt, sourceFile);
      if (array) {
        const props = propsFromObjectArray(array, sourceFile, keyOpts);
        if (props.size > 0) out.set(indexKey(fileRel, stmt.name.text), props);
      } else {
        const obj = objectLiteralFromFunctionBody(stmt);
        if (obj) {
          const props = propsFromConfigExpression(obj, sourceFile, keyOpts);
          if (props && props.size > 0) {
            out.set(indexKey(fileRel, stmt.name.text), props);
          }
        }
      }
    }

    // `export default { bar: { title: "BAR" }, ... }`
    if (ts.isExportAssignment(stmt) && stmt.expression) {
      const props = propsFromConfigExpression(
        stmt.expression,
        sourceFile,
        keyOpts,
      );
      if (props && props.size > 0) {
        out.set(indexKey(fileRel, "default"), props);
      }
    }
  }

  return out;
}

/**
 * Resolve indirect key expressions that are not plain string literals:
 *   t(field.label) | t(descriptions[item]) | t(getTitle(...)) |
 *   t(matchedTitle) | t(key) over Object.keys(Enum) |
 *   t(op) over (["A","B"] as const).map | t(type as string) via enum annotation
 */
export function resolveMappedPropKeys(
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
  relativePath: string,
  index: ObjectArrayPropIndex,
  enumIndex?: EnumValueIndex,
  helperIndex?: HelperReturnIndex,
  jsxEnumPropIndex?: JsxEnumPropIndex,
): readonly string[] {
  const node = unwrap(expr);

  // `t(\`FILTER_OPERATOR_${operator}\`)` over a mapped helper/enum/array
  if (ts.isTemplateExpression(node)) {
    const fromTemplate = keysFromPrefixedTemplate(
      node,
      sourceFile,
      relativePath,
      index,
      enumIndex,
      helperIndex,
      jsxEnumPropIndex,
    );
    if (fromTemplate.length > 0) return fromTemplate;
  }

  // Helper: t(getTitleByStatusType(variant))
  if (helperIndex && ts.isCallExpression(node)) {
    const fromHelper = resolveHelperCallKeys(
      node,
      sourceFile,
      relativePath,
      helperIndex,
      enumIndex,
    );
    if (fromHelper.length > 0) return fromHelper;
  }

  // String map: t(descriptions[item])
  if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression)) {
    const fromMap = stringMapValuesForIdent(
      node.expression,
      sourceFile,
      relativePath,
      index,
      enumIndex,
    );
    if (fromMap.length > 0) return fromMap;
  }

  // Object.keys(Enum).map((key) => t(key))
  // (["JALALI","GEORGIAN"] as const).map((op) => t(op))
  // t(type as string) when `type` is typed as a string enum
  // categories.map(item => t(item)) when categories={Object.keys(Enum)}
  // cols.map(col => t(col)) when cols = typeConvertor(...) returning enum members
  if (ts.isIdentifier(node) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) {
    const ident = ts.isIdentifier(node)
      ? node
      : ts.isIdentifier(unwrap(expr))
        ? (unwrap(expr) as ts.Identifier)
        : undefined;
    if (ident) {
      const fromEnumKeys = keysFromObjectKeysEnumMapParam(
        ident,
        sourceFile,
        relativePath,
        enumIndex,
        jsxEnumPropIndex,
      );
      if (fromEnumKeys.length > 0) return fromEnumKeys;

      const fromStringArray = keysFromStringLiteralArrayMapParam(
        ident,
        sourceFile,
        relativePath,
        enumIndex,
      );
      if (fromStringArray.length > 0) return fromStringArray;

      const fromEnumArray = keysFromEnumArrayMapParam(
        ident,
        sourceFile,
        relativePath,
        enumIndex,
      );
      if (fromEnumArray.length > 0) return fromEnumArray;

      const fromHelperMap = keysFromHelperResultMapParam(
        ident,
        sourceFile,
        relativePath,
        helperIndex,
        enumIndex,
        jsxEnumPropIndex,
      );
      if (fromHelperMap.length > 0) return fromHelperMap;

      const fromEnumAnn = keysFromEnumTypedIdent(
        ident,
        sourceFile,
        relativePath,
        enumIndex,
      );
      if (fromEnumAnn.length > 0) return fromEnumAnn;

      // const matchedTitle = getRouteParam(path, "title"); t(matchedTitle)
      const fromRoute = keysFromRouteParamBinding(
        ident,
        sourceFile,
        index,
      );
      if (fromRoute.length > 0) return fromRoute;

      // for (const key in apiMap) t(key) — keys are string-enum values
      // (e.g. IPropertyType.STRING) reachable via imports / type files.
      const fromForInEnum = keysFromForInReachableEnums(
        ident,
        sourceFile,
        relativePath,
        enumIndex,
      );
      if (fromForInEnum.length > 0) return fromForInEnum;

      // const label = map[item] ? map[item] : item; t(label)
      const fromLocalAlias = keysFromLocalKeyAlias(
        ident,
        sourceFile,
        relativePath,
        index,
        helperIndex,
        enumIndex,
      );
      if (fromLocalAlias.length > 0) return fromLocalAlias;
    }
  }

  // t(toolboxIcons()[mode]!.tooltip) / t(configs[id].title)
  const deepAccess = deepConfigPropertyAccess(node);
  if (deepAccess && WIDE_INDEX_PROPS.has(deepAccess.property)) {
    const fromDeep = keysFromConfigRoot(
      deepAccess.root,
      deepAccess.property,
      sourceFile,
      relativePath,
      index,
      enumIndex,
    );
    if (fromDeep.length > 0) return fromDeep;
  }

  const access = propertyAccess(node);
  if (!access) {
    // Nested: t(node.data.actionType) — not a single-level access.
    const fromNestedEnum = keysFromEnumTypedPropertyAccess(
      node,
      sourceFile,
      relativePath,
      enumIndex,
    );
    if (fromNestedEnum.length > 0) return fromNestedEnum;
    return [];
  }

  const collection = collectionForMapParam(access.object, sourceFile);
  if (collection) {
    const fromCollection = keysFromCollection(
      collection,
      access.property,
      sourceFile,
      relativePath,
      index,
      enumIndex,
    );
    if (fromCollection.length > 0) return fromCollection;
    // Map over props/config we couldn't fully resolve (e.g. config.steps).
    // Prefer same-file / related configs — never every `name` in the project
    // (that leaks route slugs like "map" into unrelated `t(ds.name)` sites).
    if (WIDE_INDEX_PROPS.has(access.property)) {
      return keysForPropFromIndex(access.property, index, relativePath);
    }
  }

  // `t(currentStatus.text)` when currentStatus comes from an indexed config.
  const fromLocalConfig = keysFromLocalConfigLookup(
    access.object,
    access.property,
    sourceFile,
    relativePath,
    index,
  );
  if (fromLocalConfig.length > 0) return fromLocalConfig;

  // `t(item.translation)` when `item` is a props/parameter binding.
  if (isPropsOrParamObjectBinding(access.object, sourceFile)) {
    return keysForPropFromIndex(access.property, index, relativePath);
  }

  // `t(data.actionType)` when actionType is a string enum (ActionType).
  const fromEnumProp = keysFromEnumTypedPropertyAccess(
    node,
    sourceFile,
    relativePath,
    enumIndex,
  );
  if (fromEnumProp.length > 0) return fromEnumProp;

  return [];
}

/**
 * Demand-driven: any `t(x.prop)` on a props/param object pulls static `prop`
 * values from indexed object-array / object-config entries that are related to
 * the usage file (same file/dir tree, shared app-configs, *Config modules).
 */
function keysForPropFromIndex(
  propName: string,
  index: ObjectArrayPropIndex,
  usageRelativePath?: string,
  entryFileFilter?: (entryFile: string) => boolean,
): readonly string[] {
  if (!WIDE_INDEX_PROPS.has(propName)) return [];
  const out: string[] = [];
  for (const [entryKey, props] of index) {
    const entryFile = entryKey.split("#")[0] ?? entryKey;
    if (entryFileFilter && !entryFileFilter(entryFile)) continue;
    if (
      usageRelativePath &&
      !entryFileFilter &&
      !isRelevantPropIndexEntry(entryKey, usageRelativePath)
    ) {
      continue;
    }
    const keys = props.get(propName);
    if (!keys) continue;
    for (const key of keys) {
      if (key.length > 0 && !out.includes(key)) out.push(key);
    }
  }
  return out;
}

/** Limit cross-file prop leakage (e.g. explore header keys → navigation t()). */
function isRelevantPropIndexEntry(
  indexEntryKey: string,
  usageRelativePath: string,
): boolean {
  const entryFile = indexEntryKey.split("#")[0] ?? indexEntryKey;
  const usage = normalizeRel(usageRelativePath);
  const entry = normalizeRel(entryFile);
  if (entry === usage) return true;

  const usageDir = usage.includes("/")
    ? usage.slice(0, usage.lastIndexOf("/"))
    : "";
  if (usageDir && (entry.startsWith(`${usageDir}/`) || entry === usageDir)) {
    return true;
  }

  // Shared app config modules (navigationConfig, etc.).
  if (/(^|\/)app-configs\//.test(entry) || /Config\.[cm]?[jt]sx?$/i.test(entry)) {
    return true;
  }

  // Same feature folder under src/app/(pages|layout)/… first two segments.
  const usageFeature = featureFolder(usage);
  const entryFeature = featureFolder(entry);
  if (usageFeature && entryFeature && usageFeature === entryFeature) {
    return true;
  }

  return false;
}

function featureFolder(rel: string): string | undefined {
  const parts = rel.split("/");
  // src/app/pages/explore/... → pages/explore
  // src/app/layout/main/... → layout/main
  const appIdx = parts.indexOf("app");
  if (appIdx >= 0 && parts.length > appIdx + 2) {
    return `${parts[appIdx + 1]}/${parts[appIdx + 2]}`;
  }
  return undefined;
}

/**
 * True when `id` is a function parameter or destructured props binding
 * (e.g. `function NavItem({ item })` / `props.item` local).
 */
function isPropsOrParamObjectBinding(
  id: ts.Identifier,
  sourceFile: ts.SourceFile,
): boolean {
  const name = id.text;
  const usePos = id.getStart(sourceFile);
  let found = false;

  const visit = (node: ts.Node): void => {
    if (found) return;

    if (ts.isParameter(node)) {
      if (
        ts.isIdentifier(node.name) &&
        node.name.text === name &&
        node.name.getStart(sourceFile) < usePos
      ) {
        found = true;
        return;
      }
      if (ts.isObjectBindingPattern(node.name)) {
        for (const el of node.name.elements) {
          if (
            !el.dotDotDotToken &&
            ts.isIdentifier(el.name) &&
            el.name.text === name &&
            el.name.getStart(sourceFile) < usePos
          ) {
            found = true;
            return;
          }
        }
      }
    }

    // const { item } = props;  (or props.item assigned)
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.name.getStart(sourceFile) < usePos
    ) {
      for (const el of node.name.elements) {
        if (
          !el.dotDotDotToken &&
          ts.isIdentifier(el.name) &&
          el.name.text === name
        ) {
          found = true;
          return;
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function keyOptions(
  relativePath: string,
  enumIndex?: EnumValueIndex,
): StaticKeyOptions | undefined {
  if (!enumIndex) return { relativePath };
  return { relativePath, enumIndex };
}

function keysFromCollection(
  collection: ts.Expression,
  propName: string,
  sourceFile: ts.SourceFile,
  relativePath: string,
  index: ObjectArrayPropIndex,
  enumIndex: EnumValueIndex | undefined,
): readonly string[] {
  const unwrapped = unwrap(collection);
  const keyOpts = keyOptions(relativePath, enumIndex);

  if (ts.isArrayLiteralExpression(unwrapped)) {
    return pluckStringProp(unwrapped, propName, sourceFile, keyOpts);
  }

  // Object.values(chartConfigs).map((c) => t(c.title))
  if (ts.isCallExpression(unwrapped)) {
    const valuesOf = objectValuesArgument(unwrapped);
    if (valuesOf) {
      return keysFromCollection(
        valuesOf,
        propName,
        sourceFile,
        relativePath,
        index,
        enumIndex,
      );
    }
  }

  if (ts.isIdentifier(unwrapped)) {
    const fromState = keysFromUseState(
      unwrapped,
      propName,
      sourceFile,
      relativePath,
      index,
      enumIndex,
    );
    if (fromState.length > 0) return fromState;

    const local = findLocalBindingInitializer(unwrapped, sourceFile);
    if (local) {
      const unwrappedHook = unwrapMemoCallback(local);
      // Object-of-objects local const
      const asObject = unwrap(unwrappedHook);
      if (ts.isObjectLiteralExpression(asObject)) {
        const props = propsFromObjectOfObjects(asObject, sourceFile, keyOpts);
        return props.get(propName) ?? [];
      }
      return keysFromCollection(
        unwrappedHook,
        propName,
        sourceFile,
        relativePath,
        index,
        enumIndex,
      );
    }
    const fromImport = keysFromImport(
      unwrapped.text,
      propName,
      sourceFile,
      relativePath,
      index,
    );
    if (fromImport.length > 0) return fromImport;

    const localHit = index.get(indexKey(relativePath, unwrapped.text));
    const keys = localHit?.get(propName);
    if (keys && keys.length > 0) return keys;
  }

  if (ts.isCallExpression(unwrapped)) {
    const callee = unwrap(unwrapped.expression);
    if (ts.isIdentifier(callee)) {
      const localArray = findLocalCallableArray(callee.text, sourceFile);
      if (localArray) {
        return pluckStringProp(localArray, propName, sourceFile, keyOpts);
      }
      const localConfig = findLocalCallableConfigProps(
        callee.text,
        sourceFile,
        keyOpts,
      );
      if (localConfig) {
        return localConfig.get(propName) ?? [];
      }
      const fromImport = keysFromImport(
        callee.text,
        propName,
        sourceFile,
        relativePath,
        index,
      );
      if (fromImport.length > 0) return fromImport;

      const localHit = index.get(indexKey(relativePath, callee.text));
      const keys = localHit?.get(propName);
      if (keys && keys.length > 0) return keys;
    }
  }

  // Object literal used as a string→key map (values only) — rare for .map
  if (ts.isObjectLiteralExpression(unwrapped)) {
    const props = propsFromObjectOfObjects(unwrapped, sourceFile, keyOpts);
    return props.get(propName) ?? [];
  }

  return [];
}

function objectValuesArgument(
  call: ts.CallExpression,
): ts.Expression | undefined {
  const callee = unwrap(call.expression);
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "Object" &&
    callee.name.text === "values" &&
    call.arguments[0]
  ) {
    return call.arguments[0];
  }
  return undefined;
}

/**
 * `const [items, setItems] = useState(initial)` — collect keys from the
 * initial value and from `setItems([...])` / `setItems(() => [...])` calls.
 */
function keysFromUseState(
  stateId: ts.Identifier,
  propName: string,
  sourceFile: ts.SourceFile,
  relativePath: string,
  index: ObjectArrayPropIndex,
  enumIndex: EnumValueIndex | undefined,
): readonly string[] {
  const binding = findUseStateBinding(stateId, sourceFile);
  if (!binding) return [];

  const out: string[] = [];
  const add = (keys: readonly string[]) => {
    for (const k of keys) {
      if (!out.includes(k)) out.push(k);
    }
  };

  if (binding.initial) {
    add(
      keysFromCollection(
        binding.initial,
        propName,
        sourceFile,
        relativePath,
        index,
        enumIndex,
      ),
    );
  }

  if (binding.setterName) {
    add(
      keysFromSetterCalls(
        binding.setterName,
        propName,
        sourceFile,
        relativePath,
        index,
        enumIndex,
      ),
    );
  }

  return out;
}

function findUseStateBinding(
  stateId: ts.Identifier,
  sourceFile: ts.SourceFile,
): { initial?: ts.Expression; setterName?: string } | undefined {
  const name = stateId.text;
  const usePos = stateId.getStart(sourceFile);
  let best:
    | {
        declPos: number;
        initial?: ts.Expression;
        setterName?: string;
      }
    | undefined;

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.initializer &&
      isUseStateCall(node.initializer)
    ) {
      const elements = node.name.elements;
      const stateEl = elements[0];
      const setterEl = elements[1];
      if (
        !stateEl ||
        !ts.isBindingElement(stateEl) ||
        !ts.isIdentifier(stateEl.name) ||
        stateEl.name.text !== name
      ) {
        ts.forEachChild(node, visit);
        return;
      }
      const declPos = stateEl.name.getStart(sourceFile);
      if (declPos >= usePos) {
        ts.forEachChild(node, visit);
        return;
      }
      const call = unwrap(node.initializer);
      const initial = ts.isCallExpression(call) ? call.arguments[0] : undefined;
      const setterName =
        setterEl &&
        ts.isBindingElement(setterEl) &&
        ts.isIdentifier(setterEl.name)
          ? setterEl.name.text
          : undefined;
      if (!best || declPos >= best.declPos) {
        best = {
          declPos,
          ...(initial ? { initial } : {}),
          ...(setterName ? { setterName } : {}),
        };
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return best;
}

function isUseStateCall(expr: ts.Expression): boolean {
  const call = unwrap(expr);
  if (!ts.isCallExpression(call)) return false;
  const callee = unwrap(call.expression);
  if (ts.isIdentifier(callee)) {
    return callee.text === "useState";
  }
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.name)
  ) {
    return callee.name.text === "useState";
  }
  return false;
}

function keysFromSetterCalls(
  setterName: string,
  propName: string,
  sourceFile: ts.SourceFile,
  relativePath: string,
  index: ObjectArrayPropIndex,
  enumIndex: EnumValueIndex | undefined,
): readonly string[] {
  const out: string[] = [];
  const add = (keys: readonly string[]) => {
    for (const k of keys) {
      if (!out.includes(k)) out.push(k);
    }
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === setterName &&
      node.arguments[0]
    ) {
      const arg = unwrap(node.arguments[0]!);
      if (ts.isArrayLiteralExpression(arg)) {
        add(
          keysFromCollection(
            arg,
            propName,
            sourceFile,
            relativePath,
            index,
            enumIndex,
          ),
        );
      } else if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
        const body = arg.body;
        if (ts.isArrayLiteralExpression(body)) {
          add(
            keysFromCollection(
              body,
              propName,
              sourceFile,
              relativePath,
              index,
              enumIndex,
            ),
          );
        } else if (ts.isBlock(body)) {
          const walk = (n: ts.Node): void => {
            if (ts.isReturnStatement(n) && n.expression) {
              add(
                keysFromCollection(
                  n.expression,
                  propName,
                  sourceFile,
                  relativePath,
                  index,
                  enumIndex,
                ),
              );
              return;
            }
            if (
              ts.isFunctionDeclaration(n) ||
              ts.isFunctionExpression(n) ||
              ts.isArrowFunction(n)
            ) {
              return;
            }
            ts.forEachChild(n, walk);
          };
          walk(body);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
}

function keysFromImport(
  name: string,
  propName: string,
  sourceFile: ts.SourceFile,
  relativePath: string,
  index: ObjectArrayPropIndex,
): readonly string[] {
  const modulePath = findImportModulePath(name, sourceFile);
  if (!modulePath) return [];

  for (const candidate of resolveImportedFileCandidates(
    relativePath,
    modulePath,
  )) {
    const hit = index.get(indexKey(candidate, name));
    const keys = hit?.get(propName);
    if (keys && keys.length > 0) return keys;
  }
  return [];
}

function collectionForMapParam(
  ident: ts.Identifier,
  sourceFile: ts.SourceFile,
): ts.Expression | undefined {
  const name = ident.text;
  let current: ts.Node | undefined = ident.parent;

  while (current) {
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      const callback: ts.ArrowFunction | ts.FunctionExpression = current;
      const param = callback.parameters[0];
      if (
        !param ||
        !ts.isIdentifier(param.name) ||
        param.name.text !== name
      ) {
        // Keep climbing — nested callbacks may bind a different name.
        current = callback.parent;
        continue;
      }
      const mapCall: ts.Node | undefined = callback.parent;
      if (!mapCall || !ts.isCallExpression(mapCall)) {
        current = callback.parent;
        continue;
      }
      if (!ts.isPropertyAccessExpression(mapCall.expression)) {
        current = callback.parent;
        continue;
      }
      if (!ts.isIdentifier(mapCall.expression.name)) {
        current = callback.parent;
        continue;
      }
      const method = mapCall.expression.name.text;
      if (method !== "map" && method !== "forEach" && method !== "flatMap") {
        current = callback.parent;
        continue;
      }
      // Callback must be the first argument of .map/.forEach/.flatMap.
      if (mapCall.arguments[0] !== callback) {
        current = callback.parent;
        continue;
      }
      return mapCall.expression.expression;
    }
    current = current.parent;
  }

  void sourceFile;
  return undefined;
}

function propertyAccess(
  expr: ts.Expression,
): { object: ts.Identifier; property: string } | undefined {
  const node = unwrap(expr);
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    return { object: node.expression, property: node.name.text };
  }
  if (
    ts.isElementAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.argumentExpression &&
    (ts.isStringLiteral(node.argumentExpression) ||
      ts.isNoSubstitutionTemplateLiteral(node.argumentExpression))
  ) {
    return {
      object: node.expression,
      property: node.argumentExpression.text,
    };
  }
  return undefined;
}

/**
 * `node.data.actionType` → root `node`, properties `["data", "actionType"]`.
 */
function propertyAccessChain(
  expr: ts.Expression,
): { root: ts.Identifier; properties: readonly string[] } | undefined {
  const properties: string[] = [];
  let current: ts.Expression = unwrap(expr);

  while (
    ts.isPropertyAccessExpression(current) ||
    (ts.isElementAccessExpression(current) &&
      current.argumentExpression &&
      (ts.isStringLiteral(current.argumentExpression) ||
        ts.isNoSubstitutionTemplateLiteral(current.argumentExpression)))
  ) {
    if (ts.isPropertyAccessExpression(current)) {
      properties.unshift(current.name.text);
      current = unwrap(current.expression);
      continue;
    }
    properties.unshift(
      (current.argumentExpression as ts.StringLiteral | ts.NoSubstitutionTemplateLiteral)
        .text,
    );
    current = unwrap(current.expression);
  }

  if (!ts.isIdentifier(current) || properties.length === 0) return undefined;
  return { root: current, properties };
}

/**
 * `t(data.actionType)` / `t(node.data.actionType)` when the leaf property is a
 * string enum (e.g. `actionType: ActionType`).
 */
function keysFromEnumTypedPropertyAccess(
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
  relativePath: string,
  enumIndex: EnumValueIndex | undefined,
): readonly string[] {
  const chain = propertyAccessChain(expr);
  if (!chain) return [];
  const leaf = chain.properties[chain.properties.length - 1];
  if (!leaf) return [];

  // Walk declared types from the root binding when possible.
  let typeNodes = [
    ...typeNodesFromIdentBinding(chain.root, sourceFile),
    ...typeNodesFromGenericDataBinding(chain.root, sourceFile),
  ];
  for (const prop of chain.properties) {
    if (typeNodes.length === 0) break;
    const next: ts.TypeNode[] = [];
    for (const typeNode of typeNodes) {
      const hit = propertyTypeFromObjectType(typeNode, prop, sourceFile);
      if (hit) next.push(hit);
    }
    typeNodes = next;
  }

  const out: string[] = [];
  for (const typeNode of typeNodes) {
    for (const enumName of enumNamesFromTypeNode(typeNode)) {
      for (const value of allStringEnumValues(
        enumName,
        sourceFile,
        relativePath,
        enumIndex,
      )) {
        if (!out.includes(value)) out.push(value);
      }
    }
    for (const lit of stringLiteralsFromTypeNode(typeNode)) {
      if (!out.includes(lit)) out.push(lit);
    }
  }
  if (out.length > 0) return out;

  // Fallback: actionType → ActionType when that string enum exists in the project.
  // Skip bare `type` / non-enumish names to avoid t(newValue.type) false positives.
  if (!isEnumishPropName(leaf)) return [];
  const enumName = leaf.charAt(0).toUpperCase() + leaf.slice(1);
  return allStringEnumValues(enumName, sourceFile, relativePath, enumIndex);
}

/** Props that commonly hold string-enum translation keys. */
function isEnumishPropName(prop: string): boolean {
  return (
    /(Type|Status|Kind|Mode|Category|State|Action)$/.test(prop) &&
    prop !== "type"
  );
}

/**
 * `const { data } = props` where `props: NodeProps<IActionNode>` — treat the
 * first type argument as the type of `data`.
 */
function typeNodesFromGenericDataBinding(
  id: ts.Identifier,
  sourceFile: ts.SourceFile,
): readonly ts.TypeNode[] {
  if (id.text !== "data") return [];
  const name = id.text;
  const usePos = id.getStart(sourceFile);
  const found: ts.TypeNode[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isBindingElement(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.name.getStart(sourceFile) < usePos
    ) {
      const pattern = node.parent;
      if (!ts.isObjectBindingPattern(pattern)) return;
      const decl = pattern.parent;
      if (!ts.isVariableDeclaration(decl) || !decl.initializer) return;
      const init = unwrap(decl.initializer);
      if (!ts.isIdentifier(init)) return;
      // props: NodeProps<IActionNode> or NodeProps<IActionNode & …>
      const propsTypes = typeNodesFromIdentBinding(init, sourceFile);
      for (const typeNode of propsTypes) {
        const dataType = firstTypeArgument(typeNode);
        if (dataType) found.push(dataType);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function firstTypeArgument(type: ts.TypeNode): ts.TypeNode | undefined {
  let current = type;
  while (ts.isParenthesizedTypeNode(current)) current = current.type;
  if (
    ts.isTypeReferenceNode(current) &&
    current.typeArguments &&
    current.typeArguments.length > 0
  ) {
    return current.typeArguments[0];
  }
  if (ts.isIntersectionTypeNode(current) || ts.isUnionTypeNode(current)) {
    for (const part of current.types) {
      const hit = firstTypeArgument(part);
      if (hit) return hit;
    }
  }
  return undefined;
}

function objectArrayFromExpression(
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
): ts.ArrayLiteralExpression | undefined {
  const node = unwrap(expr);
  if (ts.isArrayLiteralExpression(node)) {
    return looksLikeObjectArray(node) ? node : undefined;
  }
  if (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node)
  ) {
    return objectArrayFromFunctionBody(node, sourceFile);
  }
  return undefined;
}

/**
 * Arrays of objects, or object-of-objects configs (chartConfigs), or
 * flat string maps (`{ [Enum.X]: "KEY" }`).
 */
function propsFromConfigExpression(
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
  options?: StaticKeyOptions,
): ReadonlyMap<string, readonly string[]> | undefined {
  const node = unwrap(expr);
  if (ts.isArrayLiteralExpression(node)) {
    return looksLikeObjectArray(node)
      ? propsFromObjectArray(node, sourceFile, options)
      : undefined;
  }
  if (ts.isObjectLiteralExpression(node)) {
    if (looksLikeObjectOfObjects(node)) {
      return propsFromObjectOfObjects(node, sourceFile, options);
    }
    const flat = propsFromSingleObject(node, sourceFile, options);
    // Route / form configs (`title`, `label`, …) must keep named props — not
    // collapse into a flat string-map values bucket.
    if (
      [...flat.keys()].some(
        (k) => WIDE_INDEX_PROPS.has(k) || k === "path" || k === "id",
      )
    ) {
      return flat.size > 0 ? flat : undefined;
    }
    if (looksLikeStringMap(node)) {
      return propsFromStringMap(node, sourceFile, options);
    }
    return flat.size > 0 ? flat : undefined;
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const array = objectArrayFromFunctionBody(node, sourceFile);
    if (array) {
      return propsFromObjectArray(array, sourceFile, options);
    }
    const obj = objectLiteralFromFunctionBody(node);
    if (obj) {
      return propsFromConfigExpression(obj, sourceFile, options);
    }
    return undefined;
  }
  return undefined;
}

function looksLikeObjectOfObjects(obj: ts.ObjectLiteralExpression): boolean {
  let nested = 0;
  let objectArrays = 0;
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const init = unwrap(prop.initializer);
    if (ts.isObjectLiteralExpression(init)) nested += 1;
    if (ts.isArrayLiteralExpression(init) && looksLikeObjectArray(init)) {
      objectArrays += 1;
    }
  }
  return nested > 0 || objectArrays > 0;
}

function looksLikeStringMap(obj: ts.ObjectLiteralExpression): boolean {
  let stringValues = 0;
  let other = 0;
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const init = unwrap(prop.initializer);
    if (ts.isObjectLiteralExpression(init) || ts.isArrayLiteralExpression(init)) {
      other += 1;
      continue;
    }
    const keys = staticStringKeys(prop.initializer);
    if (keys.length > 0) stringValues += 1;
    else other += 1;
  }
  return stringValues > 0 && stringValues >= other;
}

function propsFromObjectOfObjects(
  obj: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
  options?: StaticKeyOptions,
): ReadonlyMap<string, readonly string[]> {
  const map = new Map<string, string[]>();
  const merge = (name: string, values: readonly string[]) => {
    const bucket = map.get(name) ?? [];
    for (const value of values) {
      if (value.length > 0 && !bucket.includes(value)) bucket.push(value);
    }
    if (bucket.length > 0) map.set(name, bucket);
  };

  // Own leaf props (e.g. route `title: "LOGIN"`) — must not be dropped just
  // because the object also has nested `settings` / `children`.
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const init = unwrap(prop.initializer);
    if (ts.isObjectLiteralExpression(init) || ts.isArrayLiteralExpression(init)) {
      continue;
    }
    const name = propertyNameText(prop.name, sourceFile, options);
    if (!name) continue;
    const values = staticStringKeys(
      prop.initializer,
      sourceFile,
      new Set(),
      options,
    );
    if (values.length > 0) merge(name, values);
  }

  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const init = unwrap(prop.initializer);
    if (ts.isArrayLiteralExpression(init) && looksLikeObjectArray(init)) {
      const nestedProps = propsFromObjectArray(init, sourceFile, options);
      for (const [n, v] of nestedProps) merge(n, v);
      continue;
    }
    if (ts.isObjectLiteralExpression(init)) {
      // Treat nested object like a one-element "array" entry.
      for (const nested of init.properties) {
        if (!ts.isPropertyAssignment(nested)) continue;
        const name = propertyNameText(nested.name, sourceFile, options);
        if (!name) continue;
        const nestedInit = unwrap(nested.initializer);
        if (
          ts.isArrayLiteralExpression(nestedInit) &&
          looksLikeObjectArray(nestedInit)
        ) {
          const nestedProps = propsFromObjectArray(
            nestedInit,
            sourceFile,
            options,
          );
          for (const [n, v] of nestedProps) merge(n, v);
          continue;
        }
        const values = staticStringKeys(
          nested.initializer,
          sourceFile,
          new Set(),
          options,
        );
        if (values.length > 0) merge(name, values);
      }
    }
  }
  return map;
}

/** Synthetic index bucket for flat string→key maps. */
const STRING_MAP_VALUES = "__stringMapValues__";

function propsFromStringMap(
  obj: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
  options?: StaticKeyOptions,
): ReadonlyMap<string, readonly string[]> {
  const values = collectStringMapValues(obj, sourceFile, options);
  if (values.length === 0) return new Map();
  return new Map([[STRING_MAP_VALUES, values]]);
}

function collectStringMapValues(
  obj: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
  options?: StaticKeyOptions,
): readonly string[] {
  const out: string[] = [];
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const values = staticStringKeys(
      prop.initializer,
      sourceFile,
      new Set(),
      options,
    );
    for (const value of values) {
      if (value.length > 0 && !out.includes(value)) out.push(value);
    }
  }
  return out;
}

function stringMapValuesForIdent(
  id: ts.Identifier,
  sourceFile: ts.SourceFile,
  relativePath: string,
  index: ObjectArrayPropIndex,
  enumIndex: EnumValueIndex | undefined,
): readonly string[] {
  const keyOpts = keyOptions(relativePath, enumIndex);
  const local = findLocalBindingInitializer(id, sourceFile);
  if (local) {
    const obj = unwrap(local);
    if (ts.isObjectLiteralExpression(obj)) {
      return collectStringMapValues(obj, sourceFile, keyOpts);
    }
  }

  const fromImport = keysFromImport(
    id.text,
    STRING_MAP_VALUES,
    sourceFile,
    relativePath,
    index,
  );
  if (fromImport.length > 0) return fromImport;

  const localHit = index.get(indexKey(relativePath, id.text));
  return localHit?.get(STRING_MAP_VALUES) ?? [];
}

/** `fileRel#propName` → enum string values from JSX `prop={Object.keys(Enum)}`. */
export type JsxEnumPropIndex = Map<string, readonly string[]>;

export function jsxEnumPropKey(fileRel: string, propName: string): string {
  return `${normalizeRel(fileRel)}#${propName}`;
}

export function mergeJsxEnumPropIndex(
  target: JsxEnumPropIndex,
  source: JsxEnumPropIndex,
): void {
  for (const [key, values] of source) {
    const prev = target.get(key) ?? [];
    const merged = [...prev];
    for (const v of values) {
      if (!merged.includes(v)) merged.push(v);
    }
    target.set(key, merged);
  }
}

/**
 * Index JSX/call-site props that pass `Object.keys(Enum)` / `Object.values(Enum)`
 * or helper-returned string/enum arrays into a child component, so the child can
 * resolve `categories.map(item => t(item))` / `t(\`PREFIX_${item}\`)`.
 */
export function indexJsxObjectKeysEnumProps(
  sourceFile: ts.SourceFile,
  relativePath: string,
  enumIndex?: EnumValueIndex,
  helperIndex?: HelperReturnIndex,
): JsxEnumPropIndex {
  const out: JsxEnumPropIndex = new Map();

  const visit = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      indexJsxElementEnumProps(
        node,
        sourceFile,
        relativePath,
        enumIndex,
        helperIndex,
        out,
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
}

function indexJsxElementEnumProps(
  element: ts.JsxSelfClosingElement | ts.JsxOpeningElement,
  sourceFile: ts.SourceFile,
  relativePath: string,
  enumIndex: EnumValueIndex | undefined,
  helperIndex: HelperReturnIndex | undefined,
  out: JsxEnumPropIndex,
): void {
  const tag = element.tagName;
  if (!ts.isIdentifier(tag)) return;
  const targets = resolveComponentFileCandidates(tag.text, sourceFile, relativePath);
  if (targets.length === 0) return;

  for (const attr of element.attributes.properties) {
    if (!ts.isJsxAttribute(attr) || !attr.initializer) continue;
    const propName = ts.isIdentifier(attr.name)
      ? attr.name.text
      : undefined;
    if (!propName) continue;

    let expr: ts.Expression | undefined;
    if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
      expr = attr.initializer.expression;
    }
    if (!expr) continue;

    const values = stringArrayValuesFromJsxPropExpr(
      expr,
      sourceFile,
      relativePath,
      enumIndex,
      helperIndex,
    );
    if (values.length === 0) continue;

    for (const target of targets) {
      const key = jsxEnumPropKey(target, propName);
      const prev = out.get(key) ?? [];
      const merged = [...prev];
      for (const v of values) {
        if (!merged.includes(v)) merged.push(v);
      }
      out.set(key, merged);
    }
  }
}

/**
 * Resolve JSX prop expressions that feed `.map(item => t(...))`:
 *   Object.keys(Enum) | helper() | local = helper() | ["A","B"]
 */
function stringArrayValuesFromJsxPropExpr(
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
  relativePath: string,
  enumIndex: EnumValueIndex | undefined,
  helperIndex: HelperReturnIndex | undefined,
): readonly string[] {
  const node = unwrap(expr);
  const enumName = objectKeysOrValuesEnum(node);
  if (enumName) {
    return allStringEnumValues(enumName, sourceFile, relativePath, enumIndex);
  }

  if (helperIndex && ts.isCallExpression(node)) {
    const fromHelper = resolveHelperCallKeys(
      node,
      sourceFile,
      relativePath,
      helperIndex,
      enumIndex,
    );
    if (fromHelper.length > 0) return fromHelper;
  }

  if (ts.isIdentifier(node)) {
    const init = findLocalBindingInitializer(node, sourceFile);
    if (init) {
      return stringArrayValuesFromJsxPropExpr(
        init,
        sourceFile,
        relativePath,
        enumIndex,
        helperIndex,
      );
    }
  }

  const keyOpts = keyOptions(relativePath, enumIndex);
  const fromArray = stringLiteralArrayKeys(node, sourceFile, keyOpts);
  if (fromArray.length > 0) return fromArray;

  return [];
}

function resolveComponentFileCandidates(
  localName: string,
  sourceFile: ts.SourceFile,
  relativePath: string,
): readonly string[] {
  const modulePath = findImportModulePathForName(localName, sourceFile);
  if (!modulePath) {
    // Same-file component: `<DWTab …>` declared in this file.
    return [normalizeRel(relativePath)];
  }
  return resolveImportedFileCandidates(relativePath, modulePath);
}

function findImportModulePathForName(
  localName: string,
  sourceFile: ts.SourceFile,
): string | undefined {
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (
      stmt.importClause.name &&
      stmt.importClause.name.text === localName
    ) {
      return stmt.moduleSpecifier.text;
    }
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

/**
 * `Object.keys(Enum).map((key) => t(key))` / `Object.values(Enum).map(...)`.
 * Also: prop-passed `categories={Object.keys(Enum)}` → child `categories.map(t)`.
 */
function keysFromObjectKeysEnumMapParam(
  id: ts.Identifier,
  sourceFile: ts.SourceFile,
  relativePath: string,
  enumIndex: EnumValueIndex | undefined,
  jsxEnumPropIndex?: JsxEnumPropIndex,
): readonly string[] {
  const name = id.text;
  let current: ts.Node | undefined = id.parent;

  while (current) {
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      const callback: ts.ArrowFunction | ts.FunctionExpression = current;
      const param = callback.parameters[0];
      if (
        !param ||
        !ts.isIdentifier(param.name) ||
        param.name.text !== name
      ) {
        current = callback.parent;
        continue;
      }
      const mapCall: ts.Node | undefined = callback.parent;
      if (!mapCall || !ts.isCallExpression(mapCall)) {
        current = callback.parent;
        continue;
      }
      if (!ts.isPropertyAccessExpression(mapCall.expression)) {
        current = callback.parent;
        continue;
      }
      const method = mapCall.expression.name.text;
      if (method !== "map" && method !== "forEach" && method !== "flatMap") {
        current = callback.parent;
        continue;
      }
      if (mapCall.arguments[0] !== callback) {
        current = callback.parent;
        continue;
      }
      const receiver = unwrap(mapCall.expression.expression);
      const enumName = objectKeysOrValuesEnum(receiver);
      if (enumName) {
        return allStringEnumValues(
          enumName,
          sourceFile,
          relativePath,
          enumIndex,
        );
      }

      // const categories = Object.keys(Enum); categories.map(...)
      if (ts.isIdentifier(receiver)) {
        const fromLocal = keysFromLocalObjectKeysBinding(
          receiver,
          sourceFile,
          relativePath,
          enumIndex,
        );
        if (fromLocal.length > 0) return fromLocal;

        if (jsxEnumPropIndex) {
          const fromProp = jsxEnumPropIndex.get(
            jsxEnumPropKey(relativePath, receiver.text),
          );
          if (fromProp && fromProp.length > 0) return fromProp;
        }
      }
      current = callback.parent;
      continue;
    }
    current = current.parent;
  }
  return [];
}

function keysFromLocalObjectKeysBinding(
  id: ts.Identifier,
  sourceFile: ts.SourceFile,
  relativePath: string,
  enumIndex: EnumValueIndex | undefined,
): readonly string[] {
  const name = id.text;
  const usePos = id.getStart(sourceFile);
  let best: { declPos: number; values: readonly string[] } | undefined;

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      const declPos = node.name.getStart(sourceFile);
      if (declPos >= usePos) return;
      const enumName = objectKeysOrValuesEnum(unwrap(node.initializer));
      if (!enumName) return;
      const values = allStringEnumValues(
        enumName,
        sourceFile,
        relativePath,
        enumIndex,
      );
      if (values.length === 0) return;
      if (!best || declPos > best.declPos) {
        best = { declPos, values };
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return best?.values ?? [];
}

/**
 * `const cols = typeConvertor(...); cols.map(col => t(col))`
 * Also: `<Child ops={getOps()} />` → `ops.map(op => t(op))` via jsx prop index.
 */
function keysFromHelperResultMapParam(
  id: ts.Identifier,
  sourceFile: ts.SourceFile,
  relativePath: string,
  helperIndex: HelperReturnIndex | undefined,
  enumIndex: EnumValueIndex | undefined,
  jsxEnumPropIndex?: JsxEnumPropIndex,
): readonly string[] {
  const name = id.text;
  let current: ts.Node | undefined = id.parent;

  while (current) {
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      const callback: ts.ArrowFunction | ts.FunctionExpression = current;
      const param = callback.parameters[0];
      if (
        !param ||
        !ts.isIdentifier(param.name) ||
        param.name.text !== name
      ) {
        current = callback.parent;
        continue;
      }
      const mapCall: ts.Node | undefined = callback.parent;
      if (!mapCall || !ts.isCallExpression(mapCall)) {
        current = callback.parent;
        continue;
      }
      if (!ts.isPropertyAccessExpression(mapCall.expression)) {
        current = callback.parent;
        continue;
      }
      const method = mapCall.expression.name.text;
      if (method !== "map" && method !== "forEach" && method !== "flatMap") {
        current = callback.parent;
        continue;
      }
      if (mapCall.arguments[0] !== callback) {
        current = callback.parent;
        continue;
      }
      const receiver = unwrap(mapCall.expression.expression);
      if (helperIndex && ts.isCallExpression(receiver)) {
        const fromCall = resolveHelperCallKeys(
          receiver,
          sourceFile,
          relativePath,
          helperIndex,
          enumIndex,
        );
        if (fromCall.length > 0) return fromCall;
      }
      if (ts.isIdentifier(receiver)) {
        if (helperIndex) {
          const fromBinding = keysFromHelperBoundIdent(
            receiver,
            sourceFile,
            relativePath,
            helperIndex,
            enumIndex,
          );
          if (fromBinding.length > 0) return fromBinding;
        }

        // Prop-fed: <Child operators={getOps()} /> → operators.map(op => t(op))
        if (jsxEnumPropIndex) {
          const fromProp = jsxEnumPropIndex.get(
            jsxEnumPropKey(relativePath, receiver.text),
          );
          if (fromProp && fromProp.length > 0) return fromProp;
        }
      }
      current = callback.parent;
      continue;
    }
    current = current.parent;
  }
  return [];
}

function keysFromHelperBoundIdent(
  id: ts.Identifier,
  sourceFile: ts.SourceFile,
  relativePath: string,
  helperIndex: HelperReturnIndex,
  enumIndex: EnumValueIndex | undefined,
): readonly string[] {
  const name = id.text;
  const usePos = id.getStart(sourceFile);
  let best: { declPos: number; values: readonly string[] } | undefined;

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      const declPos = node.name.getStart(sourceFile);
      if (declPos >= usePos) return;
      const init = unwrap(node.initializer);
      if (!ts.isCallExpression(init)) return;
      const values = resolveHelperCallKeys(
        init,
        sourceFile,
        relativePath,
        helperIndex,
        enumIndex,
      );
      if (values.length === 0) return;
      if (!best || declPos > best.declPos) {
        best = { declPos, values };
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return best?.values ?? [];
}

function objectKeysOrValuesEnum(
  expr: ts.Expression,
): string | undefined {
  if (!ts.isCallExpression(expr)) return undefined;
  const callee = unwrap(expr.expression);
  if (
    !ts.isPropertyAccessExpression(callee) ||
    !ts.isIdentifier(callee.expression) ||
    callee.expression.text !== "Object"
  ) {
    return undefined;
  }
  if (callee.name.text !== "keys" && callee.name.text !== "values") {
    return undefined;
  }
  const arg = expr.arguments[0];
  if (!arg) return undefined;
  const enumIdent = unwrap(arg);
  return ts.isIdentifier(enumIdent) ? enumIdent.text : undefined;
}

/**
 * `(["JALALI", "GEORGIAN"] as const).map((operator) => t(operator))`
 */
function keysFromStringLiteralArrayMapParam(
  id: ts.Identifier,
  sourceFile: ts.SourceFile,
  relativePath?: string,
  enumIndex?: EnumValueIndex,
): readonly string[] {
  const name = id.text;
  const keyOpts = keyOptions(relativePath ?? "", enumIndex);
  let current: ts.Node | undefined = id.parent;

  while (current) {
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      const callback: ts.ArrowFunction | ts.FunctionExpression = current;
      const param = callback.parameters[0];
      if (
        !param ||
        !ts.isIdentifier(param.name) ||
        param.name.text !== name
      ) {
        current = callback.parent;
        continue;
      }
      const mapCall: ts.Node | undefined = callback.parent;
      if (!mapCall || !ts.isCallExpression(mapCall)) {
        current = callback.parent;
        continue;
      }
      if (!ts.isPropertyAccessExpression(mapCall.expression)) {
        current = callback.parent;
        continue;
      }
      const method = mapCall.expression.name.text;
      if (method !== "map" && method !== "forEach" && method !== "flatMap") {
        current = callback.parent;
        continue;
      }
      if (mapCall.arguments[0] !== callback) {
        current = callback.parent;
        continue;
      }
      const receiver = unwrap(mapCall.expression.expression);
      const keys = stringLiteralArrayKeys(receiver, sourceFile, keyOpts);
      if (keys.length > 0) return keys;
      if (ts.isIdentifier(receiver)) {
        const init = findLocalBindingInitializer(receiver, sourceFile);
        if (init) {
          const fromInit = stringLiteralArrayKeys(init, sourceFile, keyOpts);
          if (fromInit.length > 0) return fromInit;
        }
      }
      current = callback.parent;
      continue;
    }
    current = current.parent;
  }
  return [];
}

function stringLiteralArrayKeys(
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
  options?: StaticKeyOptions,
): readonly string[] {
  let node = unwrap(expr);
  // (["A", "B"] as const)
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    node = unwrap(node.expression);
  }
  if (!ts.isArrayLiteralExpression(node)) return [];
  const out: string[] = [];
  for (const el of node.elements) {
    const keys = staticStringKeys(el, sourceFile, new Set(), options);
    for (const key of keys) {
      if (key.length > 0 && !out.includes(key)) out.push(key);
    }
  }
  return out;
}

/**
 * `availableDataType.map((item) => t(item))` when availableDataType is
 * typed as `SomeEnum[]`.
 */
function keysFromEnumArrayMapParam(
  id: ts.Identifier,
  sourceFile: ts.SourceFile,
  relativePath: string,
  enumIndex: EnumValueIndex | undefined,
): readonly string[] {
  const name = id.text;
  let current: ts.Node | undefined = id.parent;

  while (current) {
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      const callback: ts.ArrowFunction | ts.FunctionExpression = current;
      const param = callback.parameters[0];
      if (
        !param ||
        !ts.isIdentifier(param.name) ||
        param.name.text !== name
      ) {
        current = callback.parent;
        continue;
      }
      const mapCall: ts.Node | undefined = callback.parent;
      if (!mapCall || !ts.isCallExpression(mapCall)) {
        current = callback.parent;
        continue;
      }
      if (!ts.isPropertyAccessExpression(mapCall.expression)) {
        current = callback.parent;
        continue;
      }
      const method = mapCall.expression.name.text;
      if (method !== "map" && method !== "forEach" && method !== "flatMap") {
        current = callback.parent;
        continue;
      }
      if (mapCall.arguments[0] !== callback) {
        current = callback.parent;
        continue;
      }
      const receiver = unwrap(mapCall.expression.expression);
      if (ts.isIdentifier(receiver)) {
        const types = typeNodesFromIdentBinding(receiver, sourceFile);
        for (const typeNode of types) {
          const enumName = enumNameFromArrayType(typeNode);
          if (!enumName) continue;
          const values = allStringEnumValues(
            enumName,
            sourceFile,
            relativePath,
            enumIndex,
          );
          if (values.length > 0) return values;
        }
      }
      current = callback.parent;
      continue;
    }
    current = current.parent;
  }
  return [];
}

function enumNameFromArrayType(type: ts.TypeNode): string | undefined {
  let current = type;
  while (ts.isParenthesizedTypeNode(current)) current = current.type;
  if (
    ts.isArrayTypeNode(current) &&
    ts.isTypeReferenceNode(current.elementType) &&
    ts.isIdentifier(current.elementType.typeName)
  ) {
    return current.elementType.typeName.text;
  }
  if (
    ts.isTypeReferenceNode(current) &&
    ts.isIdentifier(current.typeName) &&
    current.typeName.text === "Array" &&
    current.typeArguments?.[0] &&
    ts.isTypeReferenceNode(current.typeArguments[0]) &&
    ts.isIdentifier(current.typeArguments[0].typeName)
  ) {
    return current.typeArguments[0].typeName.text;
  }
  return undefined;
}

/**
 * `t(type as string)` / `t(type)` when `type` is a props/param typed as a
 * string enum (e.g. `type?: COMPARATIVE_TYPE | string`) and/or string literals.
 */
function keysFromEnumTypedIdent(
  id: ts.Identifier,
  sourceFile: ts.SourceFile,
  relativePath: string,
  enumIndex: EnumValueIndex | undefined,
): readonly string[] {
  const typeNodes = typeNodesFromIdentBinding(id, sourceFile);
  if (typeNodes.length === 0) return [];
  const out: string[] = [];
  let widenedToString = false;
  for (const typeNode of typeNodes) {
    if (typeIncludesBareString(typeNode)) widenedToString = true;
    for (const enumName of enumNamesFromTypeNode(typeNode)) {
      for (const value of allStringEnumValues(
        enumName,
        sourceFile,
        relativePath,
        enumIndex,
      )) {
        if (!out.includes(value)) out.push(value);
      }
    }
    for (const lit of stringLiteralsFromTypeNode(typeNode)) {
      if (!out.includes(lit)) out.push(lit);
    }
  }
  // Enum | string often means API/legacy values beyond the enum (e.g. renamed
  // ANY_GEO_POINT → ANY_GEO_SHAPE). Include the common legacy sibling.
  if (widenedToString && out.includes("ANY_GEO_SHAPE") && !out.includes("ANY_GEO_POINT")) {
    out.push("ANY_GEO_POINT");
  }
  return out;
}

function typeIncludesBareString(type: ts.TypeNode): boolean {
  let found = false;
  const visit = (node: ts.TypeNode): void => {
    let current = node;
    while (ts.isParenthesizedTypeNode(current)) current = current.type;
    if (current.kind === ts.SyntaxKind.StringKeyword) found = true;
    if (ts.isUnionTypeNode(current)) {
      for (const part of current.types) visit(part);
    }
  };
  visit(type);
  return found;
}

function typeNodesFromIdentBinding(
  id: ts.Identifier,
  sourceFile: ts.SourceFile,
): readonly ts.TypeNode[] {
  const name = id.text;
  const usePos = id.getStart(sourceFile);
  const found: ts.TypeNode[] = [];

  const considerType = (type: ts.TypeNode | undefined): void => {
    if (type) found.push(type);
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isParameter(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.name.getStart(sourceFile) < usePos
    ) {
      considerType(node.type);
    }
    // function({ type }: Props) 
    if (
      ts.isBindingElement(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.name.getStart(sourceFile) < usePos
    ) {
      const propName = node.propertyName
        ? propertyNameText(node.propertyName)
        : node.name.text;
      const param = enclosingParameter(node);
      if (param?.type && propName) {
        considerType(
          propertyTypeFromObjectType(param.type, propName, sourceFile),
        );
      }
      // const { type } = props; where props: Props
      const fromLocal = typeFromDestructuredPropsBinding(
        node,
        propName ?? name,
        sourceFile,
      );
      considerType(fromLocal);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/**
 * `const { type } = props` where `props` is a parameter typed as `Props`.
 */
function typeFromDestructuredPropsBinding(
  element: ts.BindingElement,
  propName: string,
  sourceFile: ts.SourceFile,
): ts.TypeNode | undefined {
  const pattern = element.parent;
  if (!ts.isObjectBindingPattern(pattern)) return undefined;
  const decl = pattern.parent;
  if (!ts.isVariableDeclaration(decl) || !decl.initializer) return undefined;
  const init = unwrap(decl.initializer);
  if (!ts.isIdentifier(init)) return undefined;
  const propsName = init.text;
  // Find parameter or const typed as Props
  let found: ts.TypeNode | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isParameter(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === propsName &&
      node.type
    ) {
      found = propertyTypeFromObjectType(node.type, propName, sourceFile);
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === propsName &&
      node.type
    ) {
      found = propertyTypeFromObjectType(node.type, propName, sourceFile);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function stringLiteralsFromTypeNode(type: ts.TypeNode): readonly string[] {
  const out: string[] = [];
  const visit = (node: ts.TypeNode): void => {
    let current = node;
    while (ts.isParenthesizedTypeNode(current)) current = current.type;
    if (
      ts.isLiteralTypeNode(current) &&
      ts.isStringLiteral(current.literal)
    ) {
      if (!out.includes(current.literal.text)) out.push(current.literal.text);
    }
    if (ts.isUnionTypeNode(current)) {
      for (const part of current.types) visit(part);
    }
  };
  visit(type);
  return out;
}

function enclosingParameter(node: ts.Node): ts.ParameterDeclaration | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isParameter(current)) return current;
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current)
    ) {
      return undefined;
    }
    current = current.parent;
  }
  return undefined;
}

function propertyTypeFromObjectType(
  type: ts.TypeNode,
  propName: string,
  sourceFile: ts.SourceFile,
): ts.TypeNode | undefined {
  let current: ts.TypeNode = type;
  while (ts.isParenthesizedTypeNode(current)) {
    current = current.type;
  }
  if (ts.isTypeLiteralNode(current)) {
    for (const member of current.members) {
      if (
        ts.isPropertySignature(member) &&
        member.name &&
        propertyNameText(member.name) === propName
      ) {
        return member.type;
      }
    }
  }
  if (ts.isTypeReferenceNode(current) && ts.isIdentifier(current.typeName)) {
    const alias = findTypeAlias(current.typeName.text, sourceFile);
    if (alias) return propertyTypeFromObjectType(alias, propName, sourceFile);
    // React Flow / similar: Node<DataType> — `.data` is the first type arg.
    if (
      propName === "data" &&
      current.typeArguments &&
      current.typeArguments.length > 0
    ) {
      return current.typeArguments[0];
    }
  }
  if (ts.isIntersectionTypeNode(current) || ts.isUnionTypeNode(current)) {
    for (const part of current.types) {
      const hit = propertyTypeFromObjectType(part, propName, sourceFile);
      if (hit) return hit;
    }
  }
  return undefined;
}

function findTypeAlias(
  name: string,
  sourceFile: ts.SourceFile,
): ts.TypeNode | undefined {
  for (const stmt of sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === name) {
      return stmt.type;
    }
    if (
      ts.isInterfaceDeclaration(stmt) &&
      stmt.name.text === name
    ) {
      // Synthesize via members — wrap as type literal walk
      return ts.factory.createTypeLiteralNode(stmt.members);
    }
  }
  return undefined;
}

function enumNamesFromTypeNode(type: ts.TypeNode): readonly string[] {
  const out: string[] = [];
  const visit = (node: ts.TypeNode): void => {
    let current = node;
    while (ts.isParenthesizedTypeNode(current)) current = current.type;
    if (ts.isTypeReferenceNode(current) && ts.isIdentifier(current.typeName)) {
      const name = current.typeName.text;
      if (name !== "string" && name !== "number" && name !== "boolean") {
        if (!out.includes(name)) out.push(name);
      }
    }
    if (ts.isUnionTypeNode(current)) {
      for (const part of current.types) visit(part);
    }
  };
  visit(type);
  return out;
}

/**
 * `const currentStatus = historyStatusColConf[status]; t(currentStatus.text)`
 */
function keysFromLocalConfigLookup(
  id: ts.Identifier,
  propName: string,
  sourceFile: ts.SourceFile,
  relativePath: string,
  index: ObjectArrayPropIndex,
): readonly string[] {
  const init = findLocalBindingInitializer(id, sourceFile);
  if (!init) return [];
  const configName = rootIndexedObjectName(init);
  if (!configName) return [];

  const localHit = index.get(indexKey(relativePath, configName));
  const localKeys = localHit?.get(propName);
  if (localKeys && localKeys.length > 0) return localKeys;

  return keysFromImport(configName, propName, sourceFile, relativePath, index);
}

function rootIndexedObjectName(expr: ts.Expression): string | undefined {
  let node = unwrap(expr);
  // a ? conf[x] : conf.NONE
  if (ts.isConditionalExpression(node)) {
    return (
      rootIndexedObjectName(node.whenTrue) ??
      rootIndexedObjectName(node.whenFalse)
    );
  }
  while (
    ts.isElementAccessExpression(node) ||
    ts.isPropertyAccessExpression(node)
  ) {
    node = unwrap(node.expression);
  }
  return ts.isIdentifier(node) ? node.text : undefined;
}

/**
 * `const matchedTitle = getRouteParam(pathname, "title"); t(matchedTitle)`
 * → title strings from route modules (`*Route.tsx`), not every `title` in the app.
 */
function keysFromRouteParamBinding(
  id: ts.Identifier,
  sourceFile: ts.SourceFile,
  index: ObjectArrayPropIndex,
): readonly string[] {
  const init = findLocalBindingInitializer(id, sourceFile);
  if (!init) return [];
  const call = unwrap(init);
  if (!ts.isCallExpression(call)) return [];
  const callee = unwrap(call.expression);
  const calleeName = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)
      ? callee.name.text
      : undefined;
  if (
    calleeName !== "getRouteParam" &&
    calleeName !== "useRouteParameter"
  ) {
    return [];
  }
  // Second arg is the route field name: "title" | "settings" | ...
  const propArg = call.arguments[1];
  if (!propArg) return [];
  if (
    !ts.isStringLiteral(propArg) &&
    !ts.isNoSubstitutionTemplateLiteral(propArg)
  ) {
    return [];
  }
  return keysForPropFromIndex(propArg.text, index, undefined, isRouteConfigFile);
}

function isRouteConfigFile(entryFile: string): boolean {
  const file = normalizeRel(entryFile);
  return (
    /Route\.[cm]?[jt]sx?$/i.test(file) ||
    /routesConfig\.[cm]?[jt]sx?$/i.test(file) ||
    /(^|\/)routes\.[cm]?[jt]sx?$/i.test(file)
  );
}

/**
 * `for (const key in apiResponse) t(key)` when keys are string-enum values
 * (IPropertyType.STRING, …) reachable through this file's imports.
 */
function keysFromForInReachableEnums(
  id: ts.Identifier,
  sourceFile: ts.SourceFile,
  relativePath: string,
  enumIndex: EnumValueIndex | undefined,
): readonly string[] {
  if (!enumIndex || !isForInLoopVariable(id, sourceFile)) return [];

  const enumNames = new Set<string>();

  // Direct value imports of enums.
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    const named = stmt.importClause.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const el of named.elements) {
      const name = el.name.text;
      const values = allStringEnumValues(
        name,
        sourceFile,
        relativePath,
        enumIndex,
      );
      if (values.length > 0) enumNames.add(name);
    }
  }

  // One hop: relative type modules that import / reference string enums.
  for (const hop of collectRelativeImportPaths(sourceFile)) {
    for (const candidate of resolveImportedFileCandidates(relativePath, hop)) {
      for (const [key, members] of enumIndex) {
        if (!key.startsWith(`${normalizeRel(candidate)}#`)) continue;
        if (!isPropertyLikeStringEnum(members)) continue;
        const enumName = key.slice(key.lastIndexOf("#") + 1);
        enumNames.add(enumName);
      }
      // Enums imported by that module (e.g. types.ts → IPropertyType).
      for (const name of enumNamesImportedByModule(candidate, enumIndex)) {
        enumNames.add(name);
      }
    }
  }

  const out: string[] = [];
  for (const name of enumNames) {
    for (const value of allStringEnumValues(
      name,
      sourceFile,
      relativePath,
      enumIndex,
    )) {
      if (value.length > 0 && !out.includes(value)) out.push(value);
    }
  }
  return out;
}

function isForInLoopVariable(
  id: ts.Identifier,
  sourceFile: ts.SourceFile,
): boolean {
  const name = id.text;
  const usePos = id.getStart(sourceFile);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isForInStatement(node)) {
      const intro = node.initializer;
      if (
        ts.isVariableDeclarationList(intro) &&
        intro.declarations.some(
          (d) =>
            ts.isIdentifier(d.name) &&
            d.name.text === name &&
            d.name.getStart(sourceFile) < usePos,
        )
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** True when `id` is the loop variable of a `for...in` that encloses this use. */
export function isForInLoopVariableIdent(
  id: ts.Identifier,
  sourceFile: ts.SourceFile,
): boolean {
  return isForInLoopVariable(id, sourceFile);
}

function collectRelativeImportPaths(sourceFile: ts.SourceFile): readonly string[] {
  const out: string[] = [];
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) {
      continue;
    }
    const spec = stmt.moduleSpecifier.text;
    if (spec.startsWith(".")) out.push(spec);
  }
  return out;
}

/** Enums defined in `moduleRel` or imported into it by name. */
function enumNamesImportedByModule(
  moduleRel: string,
  enumIndex: EnumValueIndex,
): readonly string[] {
  const root = getActiveRoot();
  if (!root) return [];
  const absCandidates = moduleCandidates(moduleRel).map((c) =>
    path.isAbsolute(c) ? c : path.join(root, c),
  );
  const names: string[] = [];
  for (const abs of absCandidates) {
    let text: string;
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    // Cheap scan for `import { Foo } from` / `import type { Foo }` names that
    // exist as enums in the index — avoids a second full project parse.
    const importNames =
      text.matchAll(
        /\bimport\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+))\s+from\s+['"][^'"]+['"]/g,
      );
    for (const match of importNames) {
      const group = match[1] ?? match[2] ?? "";
      for (const part of group.split(",")) {
        const name = part
          .replace(/\bas\s+\w+/g, "")
          .replace(/\btype\b/g, "")
          .trim();
        if (!name || !/^[A-Za-z_][\w]*$/.test(name)) continue;
        const suffix = `#${name}`;
        for (const key of enumIndex.keys()) {
          if (key.endsWith(suffix) && !names.includes(name)) names.push(name);
        }
      }
    }
  }
  return names;
}

function isPropertyLikeStringEnum(
  members: ReadonlyMap<string, string>,
): boolean {
  if (members.size < 2 || members.size > 40) return false;
  let matched = 0;
  for (const [name, value] of members) {
    if (name === value && /^[A-Z][A-Z0-9_]*$/.test(value)) matched += 1;
  }
  return matched >= members.size - 1 && matched >= 2;
}

function objectArrayFromFunctionBody(
  fn: ts.FunctionLikeDeclaration,
  sourceFile: ts.SourceFile,
): ts.ArrayLiteralExpression | undefined {
  if (!fn.body) return undefined;
  if (ts.isArrayLiteralExpression(fn.body)) {
    return looksLikeObjectArray(fn.body) ? fn.body : undefined;
  }
  if (!ts.isBlock(fn.body)) return undefined;

  let found: ts.ArrayLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isReturnStatement(node) && node.expression) {
      const array = objectArrayFromExpression(node.expression, sourceFile);
      if (array) found = array;
      return;
    }
    // Don't walk into nested functions.
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node)
    ) {
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(fn.body);
  return found;
}

/** Object literal returned by a factory (`() => ({ … })` / `return { … }`). */
function objectLiteralFromFunctionBody(
  fn: ts.FunctionLikeDeclaration,
): ts.ObjectLiteralExpression | undefined {
  if (!fn.body) return undefined;
  if (!ts.isBlock(fn.body)) {
    const expr = unwrap(fn.body);
    return ts.isObjectLiteralExpression(expr) ? expr : undefined;
  }

  let found: ts.ObjectLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isReturnStatement(node) && node.expression) {
      const expr = unwrap(node.expression);
      if (ts.isObjectLiteralExpression(expr)) found = expr;
      return;
    }
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node)
    ) {
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(fn.body);
  return found;
}

/**
 * `useMemo(() => [{ name: "SAVE_AS_FILE" }], [])` → the factory expression.
 */
function unwrapMemoCallback(expr: ts.Expression): ts.Expression {
  const node = unwrap(expr);
  if (!ts.isCallExpression(node)) return expr;
  const callee = unwrap(node.expression);
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)
      ? callee.name.text
      : undefined;
  if (name !== "useMemo" && name !== "useCallback") return expr;
  const factory = node.arguments[0];
  if (!factory) return expr;
  const fn = unwrap(factory);
  if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
    if (!fn.body) return expr;
    if (!ts.isBlock(fn.body)) return fn.body;
    let found: ts.Expression | undefined;
    const visit = (n: ts.Node): void => {
      if (found) return;
      if (ts.isReturnStatement(n) && n.expression) {
        found = n.expression;
        return;
      }
      if (
        ts.isFunctionDeclaration(n) ||
        ts.isFunctionExpression(n) ||
        ts.isArrowFunction(n)
      ) {
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(fn.body);
    return found ?? expr;
  }
  return expr;
}

/**
 * Same-file factory returning an object-of-objects / object-array config.
 */
function findLocalCallableConfigProps(
  name: string,
  sourceFile: ts.SourceFile,
  options?: StaticKeyOptions,
): ReadonlyMap<string, readonly string[]> | undefined {
  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name) {
      const array = objectArrayFromFunctionBody(stmt, sourceFile);
      if (array) return propsFromObjectArray(array, sourceFile, options);
      const obj = objectLiteralFromFunctionBody(stmt);
      if (obj) return propsFromConfigExpression(obj, sourceFile, options);
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.name.text === name &&
          decl.initializer
        ) {
          return propsFromConfigExpression(
            decl.initializer,
            sourceFile,
            options,
          );
        }
      }
    }
  }
  return undefined;
}

/**
 * `t(\`FILTER_OPERATOR_${operator}\`)` when operator comes from a mapped
 * helper/enum/array (optionally via JSX props).
 */
function keysFromPrefixedTemplate(
  expr: ts.TemplateExpression,
  sourceFile: ts.SourceFile,
  relativePath: string,
  index: ObjectArrayPropIndex,
  enumIndex: EnumValueIndex | undefined,
  helperIndex: HelperReturnIndex | undefined,
  jsxEnumPropIndex: JsxEnumPropIndex | undefined,
): readonly string[] {
  if (expr.templateSpans.length !== 1) return [];
  const span = expr.templateSpans[0]!;
  const hole = unwrap(span.expression);
  if (!ts.isIdentifier(hole)) return [];

  const prefix = expr.head.text;
  const suffix = span.literal.text;
  if (!prefix && !suffix) return [];

  const holeKeys = resolveMappedPropKeys(
    hole,
    sourceFile,
    relativePath,
    index,
    enumIndex,
    helperIndex,
    jsxEnumPropIndex,
  );
  if (holeKeys.length === 0) return [];

  const out: string[] = [];
  for (const part of holeKeys) {
    const key = `${prefix}${part}${suffix}`;
    if (key.length > 0 && !out.includes(key)) out.push(key);
  }
  return out;
}

/**
 * Peel `fn()[x]!.prop` / `cfg[id].prop` down to the config root + prop name.
 */
function deepConfigPropertyAccess(
  expr: ts.Expression,
): { root: ts.Expression; property: string } | undefined {
  let node = unwrap(expr);
  if (
    !ts.isPropertyAccessExpression(node) ||
    !ts.isIdentifier(node.name)
  ) {
    return undefined;
  }
  const property = node.name.text;
  let root = unwrap(node.expression);
  // Plain `item.prop` — handled by propertyAccess.
  if (ts.isIdentifier(root)) return undefined;
  // Allow one level of element access: fn()[mode] or cfg[id]
  if (ts.isElementAccessExpression(root)) {
    root = unwrap(root.expression);
    return { root, property };
  }
  // `fn().prop` (no element access)
  if (ts.isCallExpression(root)) {
    return { root, property };
  }
  return undefined;
}

function keysFromConfigRoot(
  root: ts.Expression,
  propName: string,
  sourceFile: ts.SourceFile,
  relativePath: string,
  index: ObjectArrayPropIndex,
  enumIndex: EnumValueIndex | undefined,
): readonly string[] {
  return keysFromCollection(
    root,
    propName,
    sourceFile,
    relativePath,
    index,
    enumIndex,
  );
}

/**
 * `const label = cond ? labels[item] : item; t(label)` — union of static
 * string-map values and map-callback / helper-array keys.
 */
function keysFromLocalKeyAlias(
  id: ts.Identifier,
  sourceFile: ts.SourceFile,
  relativePath: string,
  index: ObjectArrayPropIndex,
  helperIndex: HelperReturnIndex | undefined,
  enumIndex: EnumValueIndex | undefined,
): readonly string[] {
  const init = findLocalBindingInitializer(id, sourceFile);
  if (!init) return [];
  return collectStaticKeysFromAliasExpr(
    init,
    sourceFile,
    relativePath,
    index,
    helperIndex,
    enumIndex,
    new Set([id.text]),
  );
}

function collectStaticKeysFromAliasExpr(
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
  relativePath: string,
  index: ObjectArrayPropIndex,
  helperIndex: HelperReturnIndex | undefined,
  enumIndex: EnumValueIndex | undefined,
  seen: Set<string>,
): readonly string[] {
  const node = unwrap(expr);
  const out: string[] = [];
  const add = (keys: readonly string[]) => {
    for (const k of keys) {
      if (k.length > 0 && !out.includes(k)) out.push(k);
    }
  };

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    if (node.text.length > 0) out.push(node.text);
    return out;
  }

  if (ts.isConditionalExpression(node)) {
    add(
      collectStaticKeysFromAliasExpr(
        node.whenTrue,
        sourceFile,
        relativePath,
        index,
        helperIndex,
        enumIndex,
        seen,
      ),
    );
    add(
      collectStaticKeysFromAliasExpr(
        node.whenFalse,
        sourceFile,
        relativePath,
        index,
        helperIndex,
        enumIndex,
        seen,
      ),
    );
    return out;
  }

  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    // For `a && b` prefer the right-hand (value) side; still scan both.
    add(
      collectStaticKeysFromAliasExpr(
        node.left,
        sourceFile,
        relativePath,
        index,
        helperIndex,
        enumIndex,
        seen,
      ),
    );
    add(
      collectStaticKeysFromAliasExpr(
        node.right,
        sourceFile,
        relativePath,
        index,
        helperIndex,
        enumIndex,
        seen,
      ),
    );
    return out;
  }

  if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression)) {
    add(
      stringMapValuesForIdent(
        node.expression,
        sourceFile,
        relativePath,
        index,
        enumIndex,
      ),
    );
    return out;
  }

  if (ts.isIdentifier(node)) {
    if (seen.has(node.text)) {
      // Map callback param / cycle — try helper / enum map resolution.
      add(
        keysFromHelperResultMapParam(
          node,
          sourceFile,
          relativePath,
          helperIndex,
          enumIndex,
        ),
      );
      add(
        keysFromObjectKeysEnumMapParam(
          node,
          sourceFile,
          relativePath,
          enumIndex,
        ),
      );
      add(
        keysFromStringLiteralArrayMapParam(
          node,
          sourceFile,
          relativePath,
          enumIndex,
        ),
      );
      add(
        keysFromEnumArrayMapParam(
          node,
          sourceFile,
          relativePath,
          enumIndex,
        ),
      );
      return out;
    }
    seen.add(node.text);
    const nested = findLocalBindingInitializer(node, sourceFile);
    if (nested) {
      add(
        collectStaticKeysFromAliasExpr(
          nested,
          sourceFile,
          relativePath,
          index,
          helperIndex,
          enumIndex,
          seen,
        ),
      );
      return out;
    }
    add(
      keysFromHelperResultMapParam(
        node,
        sourceFile,
        relativePath,
        helperIndex,
        enumIndex,
      ),
    );
    add(
      keysFromObjectKeysEnumMapParam(
        node,
        sourceFile,
        relativePath,
        enumIndex,
      ),
    );
    add(
      keysFromStringLiteralArrayMapParam(
        node,
        sourceFile,
        relativePath,
        enumIndex,
      ),
    );
    add(
      keysFromEnumArrayMapParam(node, sourceFile, relativePath, enumIndex),
    );
  }

  return out;
}

function looksLikeObjectArray(array: ts.ArrayLiteralExpression): boolean {
  let objects = 0;
  for (const el of array.elements) {
    if (ts.isObjectLiteralExpression(unwrap(el))) objects += 1;
  }
  return objects > 0;
}

function propsFromObjectArray(
  array: ts.ArrayLiteralExpression,
  sourceFile: ts.SourceFile,
  options?: StaticKeyOptions,
): ReadonlyMap<string, readonly string[]> {
  const map = new Map<string, string[]>();
  const merge = (name: string, values: readonly string[]) => {
    const bucket = map.get(name) ?? [];
    for (const value of values) {
      if (value.length > 0 && !bucket.includes(value)) bucket.push(value);
    }
    if (bucket.length > 0) map.set(name, bucket);
  };

  for (const el of array.elements) {
    const obj = unwrap(el);
    if (ts.isObjectLiteralExpression(obj)) {
      for (const [name, values] of propsFromSingleObject(
        obj,
        sourceFile,
        options,
      )) {
        merge(name, values);
      }
    }
  }
  return map;
}

function propsFromSingleObject(
  obj: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
  options?: StaticKeyOptions,
): ReadonlyMap<string, readonly string[]> {
  const map = new Map<string, string[]>();
  const merge = (name: string, values: readonly string[]) => {
    const bucket = map.get(name) ?? [];
    for (const value of values) {
      if (value.length > 0 && !bucket.includes(value)) bucket.push(value);
    }
    if (bucket.length > 0) map.set(name, bucket);
  };

  // Objects with both `name` and `translation` use `name` as a route/id slug
  // (e.g. "map" / "analytics") — only `translation` holds the i18n key.
  const propNames = new Set<string>();
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const n = propertyNameText(prop.name, sourceFile, options);
    if (n) propNames.add(n);
  }
  const skipNameAsKey =
    propNames.has("name") && propNames.has("translation");

  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = propertyNameText(prop.name, sourceFile, options);
    if (!name) continue;
    if (skipNameAsKey && name === "name") continue;
    const init = unwrap(prop.initializer);
    if (ts.isArrayLiteralExpression(init) && looksLikeObjectArray(init)) {
      const nested = propsFromObjectArray(init, sourceFile, options);
      for (const [nestedName, nestedValues] of nested) {
        merge(nestedName, nestedValues);
      }
      continue;
    }
    const values = staticStringKeys(
      prop.initializer,
      sourceFile,
      new Set(),
      options,
    );
    if (values.length > 0) merge(name, values);
  }
  return map;
}

function pluckStringProp(
  array: ts.ArrayLiteralExpression,
  propName: string,
  sourceFile: ts.SourceFile,
  options?: StaticKeyOptions,
): readonly string[] {
  return propsFromObjectArray(array, sourceFile, options).get(propName) ?? [];
}

function findLocalBindingInitializer(
  id: ts.Identifier,
  sourceFile: ts.SourceFile,
): ts.Expression | undefined {
  const name = id.text;
  const usePos = id.getStart(sourceFile);
  let best: { declPos: number; init: ts.Expression } | undefined;

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      const list = node.parent;
      const isConstOrLet =
        list &&
        ts.isVariableDeclarationList(list) &&
        ((list.flags & ts.NodeFlags.Const) !== 0 ||
          (list.flags & ts.NodeFlags.Let) !== 0);
      if (isConstOrLet && node.name.getStart(sourceFile) < usePos) {
        const declPos = node.name.getStart(sourceFile);
        if (!best || declPos >= best.declPos) {
          best = { declPos, init: node.initializer };
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return best?.init;
}

/**
 * Same-file function / const that returns an array of object literals.
 */
export function findLocalCallableArray(
  name: string,
  sourceFile: ts.SourceFile,
): ts.ArrayLiteralExpression | undefined {
  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name) {
      return objectArrayFromFunctionBody(stmt, sourceFile);
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.name.text === name &&
          decl.initializer
        ) {
          return objectArrayFromExpression(decl.initializer, sourceFile);
        }
      }
    }
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

function propertyNameText(
  name: ts.PropertyName,
  sourceFile?: ts.SourceFile,
  options?: StaticKeyOptions,
): string | undefined {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name) && sourceFile) {
    const keys = staticStringKeys(name.expression, sourceFile, new Set(), options);
    return keys.length === 1 ? keys[0] : undefined;
  }
  return undefined;
}

function unwrap(expr: ts.Expression): ts.Expression {
  let current = expr;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current)
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
