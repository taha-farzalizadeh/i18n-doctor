import type {
  DefinitionFact,
  IssueEngineOptions,
  UsageFact,
} from "../api/types.js";

/**
 * Matching rules when matchNamespace is enabled:
 * - Namespaced definition matches only if the usage resolves to that namespace
 *   (call-site / options.ns / defaultNS / fallbackNS).
 * - Unnamespaced definition matches by key alone (legacy catalogs).
 * - Unnamespaced usage does NOT soft-match all namespaced definitions
 *   (that caused false "used" / undercounted unused).
 *
 * Duplicate identity is always locale + namespace + key, so
 * home:SAVE / settings:SAVE / common:SAVE are never duplicates.
 */

export interface MatchContext {
  readonly matchNamespace: boolean;
  readonly defaultNS?: string;
  readonly fallbackNS?: readonly string[];
}

export function matchContextFromOptions(
  options: Pick<
    IssueEngineOptions,
    "matchNamespace" | "defaultNS" | "fallbackNS"
  > = {},
): MatchContext {
  return {
    matchNamespace: options.matchNamespace ?? true,
    ...(options.defaultNS !== undefined ? { defaultNS: options.defaultNS } : {}),
    ...(options.fallbackNS !== undefined
      ? { fallbackNS: options.fallbackNS }
      : {}),
  };
}

/** Locale-independent logical key for grouping definitions / usages. */
export function logicalKey(
  key: string,
  namespace: string | undefined,
  matchNamespace: boolean,
): string {
  if (matchNamespace && namespace) {
    return `${namespace}\u0000${key}`;
  }
  return key;
}

export function logicalDefinitionKey(
  fact: DefinitionFact,
  matchNamespace: boolean,
): string {
  return logicalKey(fact.key, fact.namespace, matchNamespace);
}

export function logicalUsageKey(
  fact: UsageFact,
  ctx: MatchContext,
): string {
  const namespaces = resolveUsageNamespaces(fact, ctx);
  return logicalKey(fact.key, namespaces[0], ctx.matchNamespace);
}

/** Whether a definition satisfies a usage under the configured rules. */
export function definitionMatchesUsage(
  definition: DefinitionFact,
  usage: UsageFact,
  ctx: MatchContext | boolean,
): boolean {
  if (definition.key !== usage.key) {
    return false;
  }

  const match = typeof ctx === "boolean"
    ? { matchNamespace: ctx }
    : ctx;

  if (!match.matchNamespace) {
    return true;
  }

  // Legacy / path-only catalogs without namespace stay key-only.
  if (!definition.namespace) {
    return true;
  }

  const usageNamespaces = resolveUsageNamespaces(usage, match);
  if (usageNamespaces.length === 0) {
    return false;
  }
  return usageNamespaces.includes(definition.namespace);
}

/**
 * Resolve effective namespace candidates for a usage:
 * options/call-site namespaces → defaultNS → (+ fallbackNS).
 */
export function resolveUsageNamespaces(
  usage: UsageFact,
  ctx: MatchContext,
): string[] {
  const out: string[] = [];
  const push = (ns: string | undefined) => {
    if (ns && !out.includes(ns)) {
      out.push(ns);
    }
  };

  push(usage.namespace);
  if (usage.namespaces) {
    for (const ns of usage.namespaces) {
      push(ns);
    }
  }

  if (out.length === 0 && ctx.defaultNS) {
    push(ctx.defaultNS);
  }

  if (out.length > 0 && ctx.fallbackNS) {
    for (const ns of ctx.fallbackNS) {
      push(ns);
    }
  }

  return out;
}

/** Identity for duplicate detection within a locale/namespace. */
export function duplicateIdentity(fact: DefinitionFact): string {
  return `${fact.locale ?? "*"}\u0000${fact.namespace ?? "*"}\u0000${fact.key}`;
}
