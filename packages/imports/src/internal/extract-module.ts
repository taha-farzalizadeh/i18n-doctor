import ts from "typescript";
import type {
  ExportBinding,
  ImportBinding,
  ModuleRecord,
  SourceLocation,
} from "../api/types.js";
import { locationOf, relativeToRoot } from "./location.js";

export interface ExportIndex {
  /** Preferential binding for a name (local > re-export). */
  readonly byName: ReadonlyMap<string, ExportBinding>;
  /** All bindings for a name (detect duplicates). */
  readonly allByName: ReadonlyMap<string, readonly ExportBinding[]>;
}

/**
 * Extract import/export bindings from a single SourceFile.
 * Framework-agnostic — no i18n logic.
 */
export function extractModuleRecord(input: {
  root: string;
  absolutePath: string;
  sourceFile: ts.SourceFile;
}): ModuleRecord {
  const { root, absolutePath, sourceFile } = input;
  const imports: ImportBinding[] = [];
  const exports: ExportBinding[] = [];
  const starExports: ModuleRecord["starExports"][number][] = [];
  const sideEffectImports: ModuleRecord["sideEffectImports"][number][] = [];

  for (const stmt of sourceFile.statements) {
    if (ts.isImportDeclaration(stmt)) {
      collectImport(stmt, sourceFile, imports, sideEffectImports);
      continue;
    }
    if (ts.isExportDeclaration(stmt)) {
      collectExportDeclaration(stmt, sourceFile, exports, starExports);
      continue;
    }
    if (ts.isExportAssignment(stmt)) {
      if (!stmt.isExportEquals) {
        exports.push({
          exportName: "default",
          kind: "default",
          location: locationOf(sourceFile, stmt),
          ...(ts.isIdentifier(stmt.expression)
            ? { localName: stmt.expression.text }
            : {}),
        });
      }
      continue;
    }

    const mods = ts.canHaveModifiers(stmt)
      ? ts.getModifiers(stmt)
      : undefined;
    if (!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      continue;
    }
    const isDefault = mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
    collectExportedDeclaration(stmt, sourceFile, exports, isDefault);
  }

  return {
    absolutePath,
    relativePath: relativeToRoot(root, absolutePath),
    imports,
    exports,
    starExports,
    sideEffectImports,
  };
}

/** Build a name → export index with precedence local/default > re-export. */
export function buildExportIndex(
  exports: readonly ExportBinding[],
): ExportIndex {
  const allByName = new Map<string, ExportBinding[]>();
  for (const binding of exports) {
    if (binding.kind === "export-all") {
      continue;
    }
    const list = allByName.get(binding.exportName) ?? [];
    list.push(binding);
    allByName.set(binding.exportName, list);
  }

  const byName = new Map<string, ExportBinding>();
  for (const [name, list] of allByName) {
    const ranked = [...list].sort(
      (a, b) => exportPrecedence(a) - exportPrecedence(b),
    );
    byName.set(name, ranked[0]!);
  }

  return { byName, allByName };
}

function exportPrecedence(binding: ExportBinding): number {
  switch (binding.kind) {
    case "local":
      return 0;
    case "default":
      return 1;
    case "re-export":
      return 2;
    case "export-all":
      return 3;
  }
}

function collectImport(
  stmt: ts.ImportDeclaration,
  sourceFile: ts.SourceFile,
  imports: ImportBinding[],
  sideEffects: { specifier: string; location: SourceLocation }[],
): void {
  if (!ts.isStringLiteral(stmt.moduleSpecifier)) {
    return;
  }
  const specifier = stmt.moduleSpecifier.text;
  const loc = locationOf(sourceFile, stmt);
  const clause = stmt.importClause;

  if (!clause) {
    sideEffects.push({ specifier, location: loc });
    return;
  }

  if (clause.isTypeOnly) {
    // Type-only imports are invisible at runtime — skip for value resolution.
    return;
  }

  if (clause.name) {
    imports.push({
      localName: clause.name.text,
      importedName: "default",
      specifier,
      kind: "default",
      location: locationOf(sourceFile, clause.name),
    });
  }

  const bindings = clause.namedBindings;
  if (!bindings) {
    return;
  }

  if (ts.isNamespaceImport(bindings)) {
    imports.push({
      localName: bindings.name.text,
      importedName: "*",
      specifier,
      kind: "namespace",
      location: locationOf(sourceFile, bindings.name),
    });
    return;
  }

  if (ts.isNamedImports(bindings)) {
    for (const el of bindings.elements) {
      if (el.isTypeOnly) {
        continue;
      }
      const imported = (el.propertyName ?? el.name).text;
      const local = el.name.text;
      imports.push({
        localName: local,
        importedName: imported,
        specifier,
        kind: "named",
        location: locationOf(sourceFile, el.name),
      });
    }
  }
}

function collectExportDeclaration(
  stmt: ts.ExportDeclaration,
  sourceFile: ts.SourceFile,
  exports: ExportBinding[],
  starExports: { specifier: string; location: SourceLocation }[],
): void {
  if (stmt.isTypeOnly) {
    return;
  }

  const from =
    stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)
      ? stmt.moduleSpecifier.text
      : undefined;

  // export * from "./x"
  if (stmt.exportClause === undefined && from) {
    starExports.push({
      specifier: from,
      location: locationOf(sourceFile, stmt),
    });
    exports.push({
      exportName: "*",
      kind: "export-all",
      location: locationOf(sourceFile, stmt),
      fromSpecifier: from,
    });
    return;
  }

  // export * as ns from "./x" — namespace re-export (terminal for `ns`)
  if (stmt.exportClause && ts.isNamespaceExport(stmt.exportClause) && from) {
    exports.push({
      exportName: stmt.exportClause.name.text,
      kind: "re-export",
      location: locationOf(sourceFile, stmt.exportClause.name),
      fromSpecifier: from,
      fromExportName: "*",
    });
    return;
  }

  // export { a, b as c } [from "./x"]
  if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
    for (const el of stmt.exportClause.elements) {
      if (el.isTypeOnly) {
        continue;
      }
      const exportName = el.name.text;
      const localOrFrom = (el.propertyName ?? el.name).text;
      if (from) {
        exports.push({
          exportName,
          kind: "re-export",
          location: locationOf(sourceFile, el.name),
          fromSpecifier: from,
          fromExportName: localOrFrom,
        });
      } else {
        exports.push({
          exportName,
          localName: localOrFrom,
          kind: "local",
          location: locationOf(sourceFile, el.name),
        });
      }
    }
  }
}

function collectExportedDeclaration(
  stmt: ts.Statement,
  sourceFile: ts.SourceFile,
  exports: ExportBinding[],
  isDefault: boolean,
): void {
  if (isDefault) {
    let localName: string | undefined;
    if (
      (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) &&
      stmt.name
    ) {
      localName = stmt.name.text;
    }
    exports.push({
      exportName: "default",
      ...(localName !== undefined ? { localName } : {}),
      kind: "default",
      location: locationOf(sourceFile, stmt),
    });
    return;
  }

  if (ts.isVariableStatement(stmt)) {
    for (const decl of stmt.declarationList.declarations) {
      for (const name of bindingNames(decl.name)) {
        exports.push({
          exportName: name,
          localName: name,
          kind: "local",
          location: locationOf(sourceFile, decl.name),
        });
      }
    }
    return;
  }

  if (
    (ts.isFunctionDeclaration(stmt) ||
      ts.isClassDeclaration(stmt) ||
      ts.isEnumDeclaration(stmt) ||
      ts.isModuleDeclaration(stmt)) &&
    stmt.name
  ) {
    // Skip type-only surface (interfaces / type aliases) for value resolution.
    exports.push({
      exportName: stmt.name.text,
      localName: stmt.name.text,
      kind: "local",
      location: locationOf(sourceFile, stmt.name),
    });
  }
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) {
    return [name.text];
  }
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    const out: string[] = [];
    for (const el of name.elements) {
      if (ts.isOmittedExpression(el)) continue;
      if (ts.isBindingElement(el)) {
        out.push(...bindingNames(el.name));
      }
    }
    return out;
  }
  return [];
}

/**
 * Find a local declaration location for `localName` in a module AST.
 */
export function findLocalDeclaration(
  sourceFile: ts.SourceFile,
  localName: string,
): SourceLocation | undefined {
  for (const stmt of sourceFile.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (bindingNames(decl.name).includes(localName)) {
          return locationOf(sourceFile, decl.name);
        }
      }
    }
    if (
      (ts.isFunctionDeclaration(stmt) ||
        ts.isClassDeclaration(stmt) ||
        ts.isEnumDeclaration(stmt)) &&
      stmt.name?.text === localName
    ) {
      return locationOf(sourceFile, stmt.name);
    }
  }
  return undefined;
}

/** Exported names that are never imported (static unused-export heuristic). */
export function listUnusedExports(
  record: ModuleRecord,
  importedExportNames: ReadonlySet<string>,
): readonly string[] {
  const unused: string[] = [];
  for (const exp of record.exports) {
    if (exp.kind === "export-all") continue;
    if (!importedExportNames.has(exp.exportName)) {
      unused.push(exp.exportName);
    }
  }
  return unused.sort((a, b) => a.localeCompare(b));
}
