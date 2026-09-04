/**
 * Format translation hover / convert index hits to LSP-shaped payloads.
 * Transport types stay in protocol/index — these are plain data.
 */

import type {
  DefinitionHit,
  HoverModel,
  CompletionItemModel,
} from "@i18n-doctor/translation-index";
import type { SourceLocation } from "@i18n-doctor/sources";

export interface ProtocolPosition {
  readonly line: number;
  readonly character: number;
}

export interface ProtocolRange {
  readonly start: ProtocolPosition;
  readonly end: ProtocolPosition;
}

export interface ProtocolLocation {
  readonly uri: string;
  readonly range: ProtocolRange;
}

export interface ProtocolHover {
  readonly contents: { readonly kind: "markdown"; readonly value: string };
  readonly range?: ProtocolRange;
}

export interface ProtocolCompletionItem {
  readonly label: string;
  readonly kind: typeof COMPLETION_KIND_CONSTANT;
  readonly detail?: string;
  readonly documentation?: string | { readonly kind: "markdown"; readonly value: string };
  readonly insertText?: string;
  readonly filterText?: string;
}

/** LSP CompletionItemKind.Constant */
export const COMPLETION_KIND_CONSTANT = 21 as const;

export function sourceLocationToRange(location: SourceLocation): ProtocolRange {
  return {
    start: {
      line: Math.max(0, location.startLine - 1),
      character: Math.max(0, location.startCharacter - 1),
    },
    end: {
      line: Math.max(0, location.endLine - 1),
      character: Math.max(0, location.endCharacter - 1),
    },
  };
}

export function definitionHitToLocation(
  hit: DefinitionHit,
  pathToUri: (absolutePath: string) => string,
): ProtocolLocation {
  return {
    uri: pathToUri(hit.uriPath),
    range: sourceLocationToRange(hit.range),
  };
}

export function formatHoverMarkdown(model: HoverModel): string {
  const lines: string[] = [];
  lines.push(`\`${model.key}\``);
  lines.push("");

  if (model.missing) {
    lines.push("**Missing translation**");
    if (model.namespace) {
      lines.push("");
      lines.push(`Namespace: ${model.namespace}`);
    }
    return lines.join("\n");
  }

  for (const locale of model.locales) {
    lines.push(`${localeLabel(locale.locale)}: ${String(locale.value)}`);
  }

  if (model.namespace) {
    lines.push("");
    lines.push(`Namespace: ${model.namespace}`);
  }

  if (model.locales.length > 0) {
    lines.push("");
    lines.push("Source");
    for (const locale of model.locales) {
      const label = localeLabel(locale.locale);
      lines.push(
        `${label}: \`${locale.relativePath}:${locale.line}\``,
      );
    }
  } else if (model.source) {
    lines.push("");
    lines.push("Source");
    lines.push(`\`${model.source.relativePath}:${model.source.line}\``);
  }

  return lines.join("\n").trimEnd();
}

function localeLabel(locale: string): string {
  const known: Record<string, string> = {
    en: "English",
    fa: "Persian",
    ar: "Arabic",
    de: "German",
    fr: "French",
    es: "Spanish",
    it: "Italian",
    ja: "Japanese",
    ko: "Korean",
    zh: "Chinese",
    pt: "Portuguese",
    ru: "Russian",
    tr: "Turkish",
    nl: "Dutch",
    pl: "Polish",
  };
  return known[locale] ?? locale.toUpperCase();
}

export function completionItemFromModel(
  model: CompletionItemModel,
): ProtocolCompletionItem {
  return {
    label: model.label,
    kind: COMPLETION_KIND_CONSTANT,
    ...(model.detail !== undefined ? { detail: model.detail } : {}),
    ...(model.documentation !== undefined
      ? {
          documentation: {
            kind: "markdown" as const,
            value: model.documentation,
          },
        }
      : {}),
    insertText: model.key,
    filterText: model.key,
  };
}
