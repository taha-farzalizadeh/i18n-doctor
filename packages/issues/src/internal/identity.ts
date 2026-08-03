import type { DefinitionFact, UsageFact } from "../api/types.js";

/**
 * Matching rules when matchNamespace is enabled:
 * - If BOTH definition and usage declare a namespace, namespaces must be equal.
 * - Otherwise match on key alone.
 *
 * This prevents `HomePage:title` from matching `Auth:title` while still
 * allowing unnamespaced usages to resolve against namespaced definitions.
 */

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
  matchNamespace: boolean,
): string {
  return logicalKey(fact.key, fact.namespace, matchNamespace);
}

/** Whether a definition satisfies a usage under the configured rules. */
export function definitionMatchesUsage(
  definition: DefinitionFact,
  usage: UsageFact,
  matchNamespace: boolean,
): boolean {
  if (definition.key !== usage.key) {
    return false;
  }
  if (!matchNamespace) {
    return true;
  }
  if (definition.namespace && usage.namespace) {
    return definition.namespace === usage.namespace;
  }
  return true;
}

/** Identity for duplicate detection within a locale/namespace. */
export function duplicateIdentity(fact: DefinitionFact): string {
  return `${fact.locale ?? "*"}\u0000${fact.namespace ?? "*"}\u0000${fact.key}`;
}
