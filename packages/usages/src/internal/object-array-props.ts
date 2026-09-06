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
 */

import ts from "typescript";
import type { StaticKeyOptions } from "./ast-helpers.js";
import { staticStringKeys } from "./ast-helpers.js";
import type { EnumValueIndex } from "./enum-values.js";
import { allStringEnumValues } from "./enum-values.js";
import type { HelperReturnIndex } from "./helper-returns.js";
import { resolveHelperCallKeys } from "./helper-returns.js";

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
  "name",
  "text",
  "headerName",
  "message",
  "placeholder",
  "description",
  "translateValue",
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
      if (!array) continue;
      const props = propsFromObjectArray(array, sourceFile, keyOpts);
      if (props.size > 0) out.set(indexKey(fileRel, stmt.name.text), props);
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
 *   t(matchedTitle) | t(key) over Object.keys(Enum)
 */
export function resolveMappedPropKeys(
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
  relativePath: string,
  index: ObjectArrayPropIndex,
  enumIndex?: EnumValueIndex,
  helperIndex?: HelperReturnIndex,
): readonly string[] {
  const node = unwrap(expr);

  // Helper: t(getTitleByStatusType(variant))
  if (helperIndex && ts.isCallExpression(node)) {
    const fromHelper = resolveHelperCallKeys(
      node,
      sourceFile,
      relativePath,
      helperIndex,
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
  if (ts.isIdentifier(node)) {
    const fromEnumKeys = keysFromObjectKeysEnumMapParam(
      node,
      sourceFile,
      relativePath,
      enumIndex,
    );
    if (fromEnumKeys.length > 0) return fromEnumKeys;

    // const matchedTitle = getRouteParam(path, "title"); t(matchedTitle)
    const fromRoute = keysFromRouteParamBinding(
      node,
      sourceFile,
      index,
    );
    if (fromRoute.length > 0) return fromRoute;
  }

  const access = propertyAccess(node);
  if (!access) return [];

  const collection = collectionForMapParam(access.object, sourceFile);
  if (collection) {
    return keysFromCollection(
      collection,
      access.property,
      sourceFile,
      relativePath,
      index,
      enumIndex,
    );
  }

  // `t(item.translation)` when `item` is a props/parameter binding.
  if (isPropsOrParamObjectBinding(access.object, sourceFile)) {
    return keysForPropFromIndex(access.property, index);
  }

  return [];
}

/**
 * Demand-driven: any `t(x.prop)` on a props/param object pulls static `prop`
 * values from every indexed object-array / object-config (incl. nested children),
 * but only for prop names that commonly hold translation keys.
 */
function keysForPropFromIndex(
  propName: string,
  index: ObjectArrayPropIndex,
): readonly string[] {
  if (!WIDE_INDEX_PROPS.has(propName)) return [];
  const out: string[] = [];
  for (const props of index.values()) {
    const keys = props.get(propName);
    if (!keys) continue;
    for (const key of keys) {
      if (key.length > 0 && !out.includes(key)) out.push(key);
    }
  }
  return out;
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
      // Object-of-objects local const
      const asObject = unwrap(local);
      if (ts.isObjectLiteralExpression(asObject)) {
        const props = propsFromObjectOfObjects(asObject, sourceFile, keyOpts);
        return props.get(propName) ?? [];
      }
      return keysFromCollection(
        local,
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
  const targetRel = resolveRelativeModule(relativePath, modulePath);
  if (!targetRel) return [];

  for (const candidate of moduleCandidates(targetRel)) {
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
    return array
      ? propsFromObjectArray(array, sourceFile, options)
      : undefined;
  }
  return undefined;
}

function looksLikeObjectOfObjects(obj: ts.ObjectLiteralExpression): boolean {
  let nested = 0;
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (ts.isObjectLiteralExpression(unwrap(prop.initializer))) nested += 1;
  }
  return nested > 0;
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

  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const init = unwrap(prop.initializer);
    if (ts.isObjectLiteralExpression(init)) {
      // Treat nested object like a one-element "array" entry.
      const fakeArray = ts.factory.createArrayLiteralExpression([init]);
      // Can't easily create fake array with ts.factory that preserves positions —
      // ingest properties directly:
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

/**
 * `Object.keys(Enum).map((key) => t(key))` / `Object.values(Enum).map(...)`.
 */
function keysFromObjectKeysEnumMapParam(
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
      const enumName = objectKeysOrValuesEnum(receiver);
      if (!enumName) {
        current = callback.parent;
        continue;
      }
      return allStringEnumValues(
        enumName,
        sourceFile,
        relativePath,
        enumIndex,
      );
    }
    current = current.parent;
  }
  return [];
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
 * `const matchedTitle = getRouteParam(pathname, "title"); t(matchedTitle)`
 * → all indexed `title` keys (routes / nav configs).
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
  return keysForPropFromIndex(propArg.text, index);
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

  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = propertyNameText(prop.name, sourceFile, options);
    if (!name) continue;
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
