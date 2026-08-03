import type {
  AliasChainStep,
  AliasGraph,
  LocalResolverOptions,
  ResolutionResult,
  SourceLocation,
} from "../api/types.js";

export function normalizeOptions(
  options: LocalResolverOptions = {},
): Required<
  Pick<
    LocalResolverOptions,
    "seedIdentifiers" | "seedMembers" | "maxChainLength"
  >
> {
  return {
    seedIdentifiers: options.seedIdentifiers ?? [
      "t",
      "i18n",
      "i18next",
      "$t",
    ],
    seedMembers: options.seedMembers ?? ["i18n.t", "i18next.t"],
    maxChainLength: options.maxChainLength ?? 32,
  };
}

/** Stable confidence for machine comparisons (2 decimal places). */
export function roundConfidence(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

/**
 * Walk the file-local alias graph from a use-site identifier.
 *
 * Rules:
 * - Stop at configured seed identifiers / seed members.
 * - Do not follow imports (they never appear as edges).
 * - Detect cycles via visited set + maxChainLength (no recursion).
 * - Look up every step at the original use-site position so reassignment
 *   and shadowing are visible; seed names still terminate the walk.
 */
export function resolveIdentifier(input: {
  originalIdentifier: string;
  position: number;
  location: SourceLocation;
  graph: AliasGraph;
  seeds: ReadonlySet<string>;
  seedMembers: ReadonlySet<string>;
  maxChainLength: number;
}): ResolutionResult {
  const chain: AliasChainStep[] = [];
  const position = input.position;
  let current = input.originalIdentifier;
  let confidence = 1;
  const visited = new Set<string>();

  chain.push({ identifier: current, kind: "seed" });

  for (let step = 0; step < input.maxChainLength; step += 1) {
    if (visited.has(current)) {
      return circularResult(input, chain);
    }
    visited.add(current);

    const binding = input.graph.bindingAt(current, position);

    if (!binding) {
      const isSeed = input.seeds.has(current);
      return {
        originalIdentifier: input.originalIdentifier,
        resolvedIdentifier: current,
        aliasChain: freezeChain(chain),
        location: input.location,
        confidence: roundConfidence(
          isSeed ? confidence : step === 0 ? 0.4 : Math.min(confidence, 0.5),
        ),
        circular: false,
        unresolved: !isSeed,
      };
    }

    chain[chain.length - 1] = {
      identifier: current,
      kind: binding.kind,
      location: binding.location,
    };
    confidence = Math.min(confidence, binding.confidence);

    if (binding.target.type === "unresolved") {
      return {
        originalIdentifier: input.originalIdentifier,
        resolvedIdentifier: current,
        aliasChain: freezeChain(chain),
        location: input.location,
        confidence: 0,
        circular: false,
        unresolved: true,
      };
    }

    if (binding.target.type === "member") {
      const member = {
        object: binding.target.object,
        property: binding.target.property,
      };
      const id = `${member.object}.${member.property}`;
      chain.push({
        identifier: id,
        kind: "seed",
        location: binding.location,
      });
      return {
        originalIdentifier: input.originalIdentifier,
        resolvedIdentifier: id,
        resolvedMember: member,
        aliasChain: freezeChain(chain),
        location: input.location,
        confidence: roundConfidence(confidence),
        circular: false,
        unresolved: false,
      };
    }

    const nextName = binding.target.name;
    chain.push({ identifier: nextName, kind: "seed" });

    // Seeds are terminals — do not follow further bindings on the seed name.
    if (input.seeds.has(nextName) || input.seedMembers.has(nextName)) {
      chain[chain.length - 1] = { identifier: nextName, kind: "seed" };
      return {
        originalIdentifier: input.originalIdentifier,
        resolvedIdentifier: nextName,
        aliasChain: freezeChain(chain),
        location: input.location,
        confidence: roundConfidence(confidence),
        circular: false,
        unresolved: false,
      };
    }

    current = nextName;
  }

  return circularResult(input, chain);
}

function circularResult(
  input: {
    originalIdentifier: string;
    location: SourceLocation;
  },
  chain: AliasChainStep[],
): ResolutionResult {
  return {
    originalIdentifier: input.originalIdentifier,
    resolvedIdentifier: chain[chain.length - 1]?.identifier ?? input.originalIdentifier,
    aliasChain: freezeChain(chain),
    location: input.location,
    confidence: 0,
    circular: true,
    unresolved: true,
  };
}

function freezeChain(chain: AliasChainStep[]): readonly AliasChainStep[] {
  return Object.freeze([...chain]);
}
