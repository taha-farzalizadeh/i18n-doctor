/**
 * Index string-valued TypeScript enums so `WpNavbar.SENSITIVE_TERMS` can be
 * treated as the translation key `"SENSITIVE_TERMS"`.
 */

import ts from "typescript";
import { resolveImportedFileCandidates } from "./module-path.js";

/** `fileRel#EnumName` → member name → string value. */
export type EnumValueIndex = Map<string, ReadonlyMap<string, string>>;

function enumIndexKey(fileRel: string, name: string): string {
  return `${normalizeRel(fileRel)}#${name}`;
}

export function indexStringEnums(
  sourceFile: ts.SourceFile,
  relativePath: string,
): EnumValueIndex {
  const out: EnumValueIndex = new Map();
  const fileRel = normalizeRel(relativePath);

  for (const stmt of sourceFile.statements) {
    if (!ts.isEnumDeclaration(stmt) || !stmt.name) continue;
    const members = new Map<string, string>();
    for (const member of stmt.members) {
      if (!member.name || !ts.isIdentifier(member.name)) continue;
      const value = stringEnumMemberValue(member);
      if (value !== undefined) {
        members.set(member.name.text, value);
      }
    }
    if (members.size > 0) {
      out.set(enumIndexKey(fileRel, stmt.name.text), members);
    }
  }

  return out;
}

export function mergeEnumValueIndex(
  target: EnumValueIndex,
  source: EnumValueIndex,
): void {
  for (const [key, members] of source) {
    target.set(key, members);
  }
}

/**
 * All string values of a string enum (same-file or indexed), for
 * `Object.keys(Enum).map((key) => t(key))` / `Object.values(Enum)`.
 */
export function allStringEnumValues(
  enumName: string,
  sourceFile: ts.SourceFile,
  relativePath: string | undefined,
  enumIndex: EnumValueIndex | undefined,
): readonly string[] {
  const local = findLocalEnumValues(enumName, sourceFile);
  if (local.length > 0) return local;

  if (!enumIndex || !relativePath) return [];

  const modulePath = findImportModulePath(enumName, sourceFile);
  if (!modulePath) {
    const members = enumIndex.get(enumIndexKey(relativePath, enumName));
    return members ? [...members.values()] : [];
  }

  if (modulePath.startsWith(".")) {
    const targetRel = resolveRelativeModule(relativePath, modulePath);
    if (!targetRel) return [];
    for (const candidate of moduleCandidates(targetRel)) {
      const members = enumIndex.get(enumIndexKey(candidate, enumName));
      if (members && members.size > 0) return [...members.values()];
    }
    return [];
  }

  // Path-alias imports: match by enum name across the index.
  const suffix = `#${enumName}`;
  for (const [key, members] of enumIndex) {
    if (!key.endsWith(suffix)) continue;
    if (members.size > 0) return [...members.values()];
  }
  return [];
}

function findLocalEnumValues(
  enumName: string,
  sourceFile: ts.SourceFile,
): readonly string[] {
  for (const stmt of sourceFile.statements) {
    if (!ts.isEnumDeclaration(stmt) || stmt.name?.text !== enumName) continue;
    const out: string[] = [];
    for (const member of stmt.members) {
      const value = stringEnumMemberValue(member);
      if (value !== undefined && !out.includes(value)) out.push(value);
    }
    return out;
  }
  return [];
}

/**
 * Resolve `Enum.Member` / `Enum["Member"]` to its string value when the enum
 * is a string enum (same-file or indexed import).
 */
export function resolveEnumMemberString(
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
  relativePath: string | undefined,
  enumIndex: EnumValueIndex | undefined,
): string | undefined {
  const access = enumMemberAccess(expr);
  if (!access) return undefined;

  const local = findLocalEnumMemberValue(
    access.enumName,
    access.memberName,
    sourceFile,
  );
  if (local !== undefined) return local;

  if (!enumIndex || !relativePath) return undefined;

  const modulePath = findImportModulePath(access.enumName, sourceFile);
  if (!modulePath) {
    // Same-file index entry (e.g. after re-parse path normalization).
    return enumIndex.get(enumIndexKey(relativePath, access.enumName))?.get(
      access.memberName,
    );
  }

  if (modulePath.startsWith(".")) {
    const targetRel = resolveRelativeModule(relativePath, modulePath);
    if (!targetRel) return undefined;
    for (const candidate of moduleCandidates(targetRel)) {
      const value = enumIndex
        .get(enumIndexKey(candidate, access.enumName))
        ?.get(access.memberName);
      if (value !== undefined) return value;
    }
    return undefined;
  }

  // Path-alias / package imports (`@core/types/wpTypes`): match by enum name.
  const suffix = `#${access.enumName}`;
  for (const [key, members] of enumIndex) {
    if (!key.endsWith(suffix)) continue;
    const value = members.get(access.memberName);
    if (value !== undefined) return value;
  }
  return undefined;
}

function stringEnumMemberValue(
  member: ts.EnumMember,
): string | undefined {
  if (!member.initializer) {
    // Ambient / auto numeric — not a translation key.
    return undefined;
  }
  if (
    ts.isStringLiteral(member.initializer) ||
    ts.isNoSubstitutionTemplateLiteral(member.initializer)
  ) {
    return member.initializer.text;
  }
  return undefined;
}

function findLocalEnumMemberValue(
  enumName: string,
  memberName: string,
  sourceFile: ts.SourceFile,
): string | undefined {
  for (const stmt of sourceFile.statements) {
    if (!ts.isEnumDeclaration(stmt) || stmt.name?.text !== enumName) continue;
    for (const member of stmt.members) {
      if (!member.name || !ts.isIdentifier(member.name)) continue;
      if (member.name.text !== memberName) continue;
      return stringEnumMemberValue(member);
    }
  }
  return undefined;
}

function enumMemberAccess(
  expr: ts.Expression,
): { enumName: string; memberName: string } | undefined {
  let current = expr;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  if (
    ts.isPropertyAccessExpression(current) &&
    ts.isIdentifier(current.expression)
  ) {
    return {
      enumName: current.expression.text,
      memberName: current.name.text,
    };
  }
  if (
    ts.isElementAccessExpression(current) &&
    ts.isIdentifier(current.expression) &&
    current.argumentExpression &&
    (ts.isStringLiteral(current.argumentExpression) ||
      ts.isNoSubstitutionTemplateLiteral(current.argumentExpression))
  ) {
    return {
      enumName: current.expression.text,
      memberName: current.argumentExpression.text,
    };
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
