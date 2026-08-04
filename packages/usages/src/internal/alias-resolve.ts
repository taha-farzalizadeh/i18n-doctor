import type { FileAliasAnalysis, ResolutionResult } from "@i18n-doctor/resolve";
import { createLocalResolver } from "@i18n-doctor/resolve";
import type ts from "typescript";
import type { FileBindingTable, TFunctionBinding } from "../api/types.js";
import { resolveTFunction } from "./bindings.js";

const resolver = createLocalResolver();

/** Analyze one source file into a reusable alias graph. */
export function analyzeFileAliases(
  sourceFile: ts.SourceFile,
  fileName?: string,
): FileAliasAnalysis {
  return resolver.analyze({
    sourceFile,
    ...(fileName !== undefined ? { fileName } : {}),
  });
}

export interface ResolvedCallee {
  /** Name to look up in FileBindingTable.tFunctions. */
  readonly lookupName: string;
  /** Present when the chain ends at a member root (i18n.t). */
  readonly member?: { readonly object: string; readonly property: string };
  readonly resolution: ResolutionResult;
  readonly aliasEvidence: string | undefined;
  /**
   * Binding from the original name or the resolved alias target.
   * Original wins so destructure renames keep namespace/origin metadata.
   */
  readonly binding: TFunctionBinding | undefined;
}

/**
 * Resolve a call callee for usage detection.
 *
 * 1. Prefer a direct FileBindingTable hit on the original identifier
 *    (covers `{ t: translate } = useTranslation()`).
 * 2. Otherwise walk the file-local alias graph (`const tx = t`, wrappers, …)
 *    and look up the resolved seed / member.
 */
export function resolveCalleeForUsage(
  bindings: FileBindingTable,
  analysis: FileAliasAnalysis,
  name: string,
  position: number,
): ResolvedCallee {
  const direct = resolveTFunction(bindings, name, position);
  const resolution = resolver.resolve({
    analysis,
    name,
    position,
  });

  if (direct) {
    return {
      lookupName: name,
      resolution,
      aliasEvidence: undefined,
      binding: direct,
    };
  }

  if (resolution.circular) {
    return {
      lookupName: name,
      resolution,
      aliasEvidence: undefined,
      binding: undefined,
    };
  }

  if (resolution.resolvedMember) {
    const chain = resolution.aliasChain.map((s) => s.identifier).join(" -> ");
    return {
      lookupName: resolution.resolvedMember.object,
      member: resolution.resolvedMember,
      resolution,
      aliasEvidence:
        resolution.originalIdentifier !== resolution.resolvedIdentifier
          ? `alias: ${chain}`
          : undefined,
      binding: undefined,
    };
  }

  const lookupName = resolution.resolvedIdentifier;
  const binding = resolveTFunction(bindings, lookupName, position);
  const chain = resolution.aliasChain.map((s) => s.identifier).join(" -> ");

  return {
    lookupName,
    resolution,
    aliasEvidence:
      lookupName !== name && resolution.aliasChain.length > 1
        ? `alias: ${chain}`
        : undefined,
    binding,
  };
}
