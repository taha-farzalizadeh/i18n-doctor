/**
 * Translation intelligence request handlers (definition / hover / completion).
 * Thin adapters over the shared TranslationIndex + cached usage catalog.
 */

import type { TranslationUsage } from "@i18n-doctor/usages";
import type { ScopeIntelligence } from "../project.js";
import {
  completionItemFromModel,
  definitionHitToLocation,
  formatHoverMarkdown,
  type ProtocolCompletionItem,
  type ProtocolHover,
  type ProtocolLocation,
} from "./format.js";
import {
  findUsageAtPosition,
  offsetAt,
  translationKeyContextAt,
  type LspPosition,
} from "./usage-at-position.js";
import { pathKey, pathToUri, type PlatformId } from "../workspace.js";

export interface IntelligenceRequest {
  readonly uri: string;
  readonly absolutePath: string;
  readonly position: LspPosition;
  readonly documentText?: string;
}

export function resolveDefinition(
  intelligence: ScopeIntelligence,
  request: IntelligenceRequest,
  platform?: PlatformId,
): ProtocolLocation[] {
  const usage = resolveStaticUsage(intelligence, request, platform);
  if (!usage) return [];

  const hits = intelligence.index.definitionsForUsage({
    key: usage.key,
    ...(usage.namespace !== undefined ? { namespace: usage.namespace } : {}),
    ...(usage.namespaces !== undefined ? { namespaces: usage.namespaces } : {}),
    ...(usage.namespaceResolved !== undefined
      ? { namespaceResolved: usage.namespaceResolved }
      : {}),
  });

  return hits.map((hit) =>
    definitionHitToLocation(hit, (absolutePath) =>
      pathToUri(absolutePath, platform),
    ),
  );
}

export function resolveHover(
  intelligence: ScopeIntelligence,
  request: IntelligenceRequest,
  platform?: PlatformId,
): ProtocolHover | null {
  const at = findUsageAtPosition(
    intelligence.usageCatalog,
    request.absolutePath,
    request.position,
    (a, b) => pathKey(a, platform) === pathKey(b, platform),
  );

  if (at.kind === "dynamic") {
    return {
      contents: {
        kind: "markdown",
        value: "Dynamic translation key — cannot resolve a static definition.",
      },
    };
  }

  if (at.kind === "none") return null;

  const usage = at.usage;
  const model = intelligence.index.hoverForUsage({
    key: usage.key,
    ...(usage.namespace !== undefined ? { namespace: usage.namespace } : {}),
    ...(usage.namespaces !== undefined ? { namespaces: usage.namespaces } : {}),
    ...(usage.namespaceResolved !== undefined
      ? { namespaceResolved: usage.namespaceResolved }
      : {}),
  });

  const range = {
    start: {
      line: Math.max(0, usage.location.line - 1),
      character: Math.max(0, usage.location.column - 1),
    },
    end: {
      line: Math.max(0, usage.location.endLine - 1),
      character: Math.max(0, usage.location.endColumn - 1),
    },
  };

  return {
    contents: {
      kind: "markdown",
      value: formatHoverMarkdown(model),
    },
    range,
  };
}

export function resolveCompletion(
  intelligence: ScopeIntelligence,
  request: IntelligenceRequest,
  platform?: PlatformId,
): ProtocolCompletionItem[] {
  const at = findUsageAtPosition(
    intelligence.usageCatalog,
    request.absolutePath,
    request.position,
    (a, b) => pathKey(a, platform) === pathKey(b, platform),
  );

  if (at.kind === "dynamic") return [];

  let prefix = "";
  let namespace: string | undefined;
  let namespaces: readonly string[] | undefined;

  if (at.kind === "static") {
    const usage = at.usage;
    namespace = usage.namespace;
    namespaces = usage.namespaces;
    prefix = prefixUpToCursor(usage, request);
  } else if (request.documentText) {
    const offset = offsetAt(request.documentText, request.position);
    const ctx = translationKeyContextAt(request.documentText, offset);
    if (!ctx?.inKeyLiteral) return [];
    prefix = ctx.prefix;
  } else {
    return [];
  }

  const items = intelligence.index.completionsForPrefix(prefix, {
    ...(namespace !== undefined ? { namespace } : {}),
    ...(namespaces !== undefined ? { namespaces } : {}),
    limit: 200,
  });

  return items.map(completionItemFromModel);
}

function resolveStaticUsage(
  intelligence: ScopeIntelligence,
  request: IntelligenceRequest,
  platform?: PlatformId,
): TranslationUsage | undefined {
  const at = findUsageAtPosition(
    intelligence.usageCatalog,
    request.absolutePath,
    request.position,
    (a, b) => pathKey(a, platform) === pathKey(b, platform),
  );
  return at.kind === "static" ? at.usage : undefined;
}

function prefixUpToCursor(
  usage: TranslationUsage,
  request: IntelligenceRequest,
): string {
  if (!request.documentText) return usage.key;
  const offset = offsetAt(request.documentText, request.position);
  const ctx = translationKeyContextAt(request.documentText, offset);
  if (ctx?.inKeyLiteral) return ctx.prefix;
  return usage.key;
}
