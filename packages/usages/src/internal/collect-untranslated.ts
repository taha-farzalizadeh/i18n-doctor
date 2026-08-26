import { traversalApi } from "@i18n-doctor/ast";
import type { FileAliasAnalysis } from "@i18n-doctor/resolve";
import ts from "typescript";
import type {
  FileBindingTable,
  UntranslatedLiteral,
  UsageLibraryId,
} from "../api/types.js";
import { resolveCalleeForUsage } from "./alias-resolve.js";
import {
  calleeIdentifier,
  endsWithProperty,
  jsxTagName,
  rootIdentifier,
  staticStringKey,
} from "./ast-helpers.js";
import { isIntlObject } from "./bindings.js";
import { locationOf } from "./location.js";

/** JSX / HTML attributes that typically carry user-visible copy. */
const USER_FACING_ATTRS = new Set([
  "title",
  "placeholder",
  "alt",
  "label",
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-valuetext",
  "aria-roledescription",
]);

/** Attributes that are almost never user-facing copy. */
const IGNORED_ATTRS = new Set([
  "className",
  "class",
  "style",
  "id",
  "key",
  "name",
  "type",
  "role",
  "htmlFor",
  "href",
  "src",
  "to",
  "action",
  "download",
  "target",
  "rel",
  "testID",
  "data-testid",
  "data-test-id",
  "data-cy",
]);

const SKIP_TAGS = new Set([
  "script",
  "style",
  "code",
  "pre",
  "samp",
  "kbd",
]);

/**
 * Find likely user-facing static strings that are not passed through a
 * translation helper (t / formatMessage / …).
 */
export function collectUntranslatedLiterals(input: {
  absolutePath: string;
  relativePath: string;
  sourceFile: ts.SourceFile;
  bindings: FileBindingTable;
  aliasAnalysis: FileAliasAnalysis;
  minConfidence: number;
}): UntranslatedLiteral[] {
  if (!fileLooksI18nAware(input.bindings)) {
    return [];
  }
  if (isTestLikePath(input.relativePath)) {
    return [];
  }

  const found: UntranslatedLiteral[] = [];
  const seen = new Set<string>();

  const consider = (
    text: string,
    node: ts.Node,
    context: UntranslatedLiteral["context"],
    attrName?: string,
  ): void => {
    const score = scoreLiteral(text);
    if (score === undefined || score < input.minConfidence) {
      return;
    }
    const location = locationOf(input.sourceFile, node);
    const dedupe = `${location.start}:${location.end}:${text}`;
    if (seen.has(dedupe)) {
      return;
    }
    seen.add(dedupe);
    found.push({
      text: truncate(text, 120),
      absolutePath: input.absolutePath,
      relativePath: input.relativePath,
      location,
      confidence: score,
      context,
      ...(attrName !== undefined ? { attribute: attrName } : {}),
      library: guessLibrary(input.bindings),
      evidence: attrName
        ? `untranslated-text: JSX attribute ${attrName}`
        : context === "jsx-text"
          ? "untranslated-text: JSX text"
          : "untranslated-text: string literal",
    });
  };

  traversalApi.forEachChild(input.sourceFile, (node) => {
    if (ts.isJsxText(node)) {
      if (isInsideSkippedJsx(node) || isInsideTranslatedJsx(node)) {
        return;
      }
      const text = normalizeJsxText(node.getText(input.sourceFile));
      if (text) {
        consider(text, node, "jsx-text");
      }
      return;
    }

    if (ts.isJsxExpression(node) && node.expression) {
      if (
        ts.isStringLiteral(node.expression) ||
        ts.isNoSubstitutionTemplateLiteral(node.expression)
      ) {
        if (
          isJsxChildExpression(node) &&
          !isInsideSkippedJsx(node) &&
          !isInsideTranslatedJsx(node) &&
          !isInsideTranslationCall(node, input)
        ) {
          consider(node.expression.text, node.expression, "jsx-expression");
        }
      }
      return;
    }

    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name)) {
      const attrName = node.name.text;
      if (IGNORED_ATTRS.has(attrName) || attrName.startsWith("data-")) {
        return;
      }
      if (!USER_FACING_ATTRS.has(attrName)) {
        return;
      }
      if (isInsideTranslatedJsx(node) || isInsideSkippedJsx(node)) {
        return;
      }
      const init = node.initializer;
      if (!init) {
        return;
      }
      if (ts.isStringLiteral(init)) {
        consider(init.text, init, "jsx-attribute", attrName);
        return;
      }
      if (ts.isJsxExpression(init) && init.expression) {
        const key = staticStringKey(init.expression, input.sourceFile);
        if (key !== undefined && !isInsideTranslationCall(init, input)) {
          consider(key, init.expression, "jsx-attribute", attrName);
        }
      }
    }
  });

  return found;
}

function fileLooksI18nAware(bindings: FileBindingTable): boolean {
  if (bindings.hooks.useTranslation || bindings.hooks.useTranslations) {
    return true;
  }
  if (bindings.hooks.useIntl || bindings.formatMessageNames.size > 0) {
    return true;
  }
  if (bindings.tFunctions.size > 0 || bindings.translationObjects.size > 0) {
    return true;
  }
  if (bindings.i18nObjects.size > 0 || bindings.translateServices.size > 0) {
    return true;
  }
  for (const spec of bindings.importSpecifiers) {
    if (
      /i18n|i18next|lingui|formatjs|react-intl|next-intl|vue-i18n|transloco|ngx-translate/i.test(
        spec,
      )
    ) {
      return true;
    }
  }
  return false;
}

function isTestLikePath(relativePath: string): boolean {
  return (
    /(^|\/)(__tests__|__mocks__|__fixtures__)(\/|$)/i.test(relativePath) ||
    /\.(test|spec|stories)\.[cm]?[jt]sx?$/i.test(relativePath)
  );
}

function normalizeJsxText(raw: string): string | undefined {
  const text = raw.replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : undefined;
}

function scoreLiteral(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed.length < 2) {
    return undefined;
  }
  if (!/[A-Za-z\u00C0-\u024F]/.test(trimmed)) {
    return undefined;
  }
  // Technical / non-prose shapes
  if (
    /^(https?:|mailto:|tel:|\/|\.\/|\.\.\/|#|[a-z]+:\/\/)/i.test(trimmed) ||
    /^[A-Z0-9_.-]+\.[A-Z0-9_.-]+$/i.test(trimmed) || // domain-ish or key.like.id without spaces
    /^#[0-9a-fA-F]{3,8}$/.test(trimmed) ||
    /^\d+([.,]\d+)?(px|rem|em|%|vh|vw)?$/.test(trimmed) ||
    /^[A-Z][A-Z0-9_]{2,}$/.test(trimmed) || // SCREAMING_SNAKE
    /^[a-z]+([A-Z][a-z0-9]+)+$/.test(trimmed) || // camelCase identifier
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(trimmed) || // kebab css class
    /^[\w./\\-]+\.(png|jpe?g|gif|svg|webp|ico|json|js|ts|tsx|css|scss)$/i.test(
      trimmed,
    )
  ) {
    return undefined;
  }

  // dotted i18n-style keys without spaces: auth.login.title
  if (!/\s/.test(trimmed) && /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i.test(trimmed)) {
    return undefined;
  }

  const letters = (trimmed.match(/[A-Za-z\u00C0-\u024F]/g) ?? []).length;
  if (letters < 2) {
    return undefined;
  }

  if (/\s/.test(trimmed) || /[.!?:,]/.test(trimmed)) {
    return 0.85;
  }
  // Single word with capitals (Hello) — still likely UI copy
  if (/^[A-Z][a-z]+(?:\s|$)/.test(trimmed) || trimmed.length >= 4) {
    return 0.7;
  }
  return 0.55;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}

function guessLibrary(bindings: FileBindingTable): UsageLibraryId {
  for (const binding of bindings.tFunctions.values()) {
    return binding.library;
  }
  if (bindings.hooks.useTranslations) {
    return "next-intl";
  }
  if (bindings.hooks.useIntl || bindings.formatMessageNames.size > 0) {
    return "react-intl";
  }
  if (bindings.hooks.useTranslation) {
    return "react-i18next";
  }
  return "unknown";
}

function isJsxChildExpression(node: ts.JsxExpression): boolean {
  const parent = node.parent;
  return (
    ts.isJsxElement(parent) ||
    ts.isJsxFragment(parent)
  );
}

function isInsideSkippedJsx(node: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isJsxOpeningElement(current) || ts.isJsxSelfClosingElement(current)) {
      const tag = jsxTagName(current).toLowerCase();
      const base = tag.includes(".") ? tag.slice(tag.lastIndexOf(".") + 1) : tag;
      if (SKIP_TAGS.has(base)) {
        return true;
      }
    }
    if (ts.isJsxElement(current)) {
      const tag = jsxTagName(current.openingElement).toLowerCase();
      const base = tag.includes(".") ? tag.slice(tag.lastIndexOf(".") + 1) : tag;
      if (SKIP_TAGS.has(base)) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

const TRANSLATED_WRAPPER_TAGS = new Set([
  "trans",
  "formattedmessage",
  "formattedhtmlmessage",
  "translation",
  "i18n",
]);

function isInsideTranslatedJsx(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) {
      const opening = ts.isJsxElement(current)
        ? current.openingElement
        : current;
      const tag = jsxTagName(opening);
      const base = (tag.includes(".") ? tag.slice(tag.lastIndexOf(".") + 1) : tag)
        .toLowerCase();
      if (TRANSLATED_WRAPPER_TAGS.has(base)) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

function isInsideTranslationCall(
  node: ts.Node,
  input: {
    bindings: FileBindingTable;
    aliasAnalysis: FileAliasAnalysis;
    sourceFile: ts.SourceFile;
  },
): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isCallExpression(current) && current.arguments.length > 0) {
      if (isTranslationCallee(current, input)) {
        // Only skip if this node is inside the key / message argument.
        if (isAncestorOrSelf(current.arguments[0]!, node)) {
          return true;
        }
        // formatMessage({ id, defaultMessage }) — defaultMessage is also copy
        // that may be intentional fallback; still skip the whole call args.
        for (const arg of current.arguments) {
          if (isAncestorOrSelf(arg, node)) {
            return true;
          }
        }
      }
    }
    if (ts.isTaggedTemplateExpression(current)) {
      const tag = calleeIdentifier(current.tag);
      if (tag === "t" || tag === "msg" || tag === "defineMessage") {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

function isTranslationCallee(
  node: ts.CallExpression,
  input: {
    bindings: FileBindingTable;
    aliasAnalysis: FileAliasAnalysis;
    sourceFile: ts.SourceFile;
  },
): boolean {
  const pos = node.arguments[0]?.getStart(input.sourceFile) ?? node.getStart();
  const ident = calleeIdentifier(node.expression);
  if (ident) {
    if (
      input.bindings.formatMessageNames.has(ident) ||
      ident === "formatMessage"
    ) {
      return true;
    }
    const alias = resolveCalleeForUsage(
      input.bindings,
      input.aliasAnalysis,
      ident,
      pos,
    );
    if (alias.binding) {
      return true;
    }
    if (
      alias.member &&
      (alias.member.property === "t" ||
        alias.member.property === "formatMessage")
    ) {
      return true;
    }
  }
  if (endsWithProperty(node.expression, "t")) {
    const root = rootIdentifier(node.expression);
    if (
      root &&
      (input.bindings.i18nObjects.has(root) ||
        input.bindings.translationObjects.has(root))
    ) {
      return true;
    }
  }
  if (endsWithProperty(node.expression, "formatMessage")) {
    const root = rootIdentifier(node.expression);
    if (root && isIntlObject(input.bindings, root)) {
      return true;
    }
  }
  return false;
}

function isAncestorOrSelf(ancestor: ts.Node, node: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    if (current === ancestor) {
      return true;
    }
    current = current.parent;
  }
  return false;
}
