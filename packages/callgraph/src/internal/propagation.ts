import type {
  CallEdge,
  CallGraph,
  FunctionGraph,
  FunctionId,
  FunctionNode,
  PropagationRecord,
  TranslationSeed,
  WrapperInfo,
} from "../api/types.js";
import { seedId } from "./location.js";
import type { ScopeMetaStore } from "./scope-meta.js";

export interface ScopedAliasRecord {
  readonly absolutePath: string;
  readonly name: string;
  readonly declPos: number;
  readonly scopeStart: number;
  readonly scopeEnd: number;
  readonly record: PropagationRecord;
}

export interface PropagationResult {
  readonly records: ReadonlyMap<FunctionId, PropagationRecord>;
  /** Position-aware aliases (same name may appear multiple times). */
  readonly aliasRecords: readonly ScopedAliasRecord[];
  readonly wrappers: readonly WrapperInfo[];
  readonly seedNodes: readonly FunctionNode[];
}

/**
 * Translation Function Propagation Engine.
 *
 * Starts from injectable seeds and propagates "is a translator" through:
 * - key-forwarding calls (`return t(k)` / `(k) => t(k)`)
 * - return-identity / return-member (`return t`, `return useTranslation().t`)
 * - assign-alias (`const tr = t`)
 * - nested wrappers (`a → b → t`)
 *
 * Prefers `edge.to` FunctionIds over bare name matching.
 * Cycle-safe worklist; never executes JavaScript.
 */
export function propagateTranslationFunctions(input: {
  functionGraph: FunctionGraph;
  callGraph: CallGraph;
  seeds: readonly TranslationSeed[];
  maxDepth: number;
  scopes?: ScopeMetaStore;
}): PropagationResult {
  const records = new Map<FunctionId, PropagationRecord>();
  const aliasMap = new Map<string, ScopedAliasRecord>();
  const seedNodes: FunctionNode[] = [];

  const seedConfidence = new Map<string, number>();
  const wildcardSeeds = new Set<string>();
  for (const seed of input.seeds) {
    for (const label of seedLabels(seed)) {
      seedConfidence.set(label, seed.confidence ?? 0.95);
      if (label.startsWith("*.")) wildcardSeeds.add(label);
    }
  }

  for (const [label, confidence] of seedConfidence) {
    const id = seedId(label);
    const node: FunctionNode = {
      id,
      name: label,
      kind: "seed",
      absolutePath: "",
      relativePath: "",
      location: zeroLoc(),
      synthetic: true,
    };
    seedNodes.push(node);
    records.set(id, {
      functionId: id,
      resolvedTranslationFunction: normalizeTerminal(label),
      callChain: [label],
      confidence,
      kind: label.includes(".") || label.includes("(") ? "member" : "passthrough",
      circular: false,
    });
  }

  // Reverse indexes
  const edgesByCallee = new Map<string, CallEdge[]>();
  for (const edge of input.callGraph.edges) {
    indexEdge(edgesByCallee, edge.calleeName, edge);
    // Member edges also answer wildcard seeds like `*.t` — only at index time.
    if (edge.calleeName.includes(".")) {
      const wild = `*.${propertyOf(edge.calleeName)}`;
      if (wildcardSeeds.has(wild)) {
        indexEdge(edgesByCallee, wild, edge);
      }
    }
  }

  const queue: FunctionId[] = [];
  let qHead = 0;
  const inQueue = new Set<FunctionId>();

  const enqueue = (id: FunctionId, rec: PropagationRecord): void => {
    const existing = records.get(id);
    if (existing && !shouldReplace(existing, rec)) {
      return;
    }
    records.set(id, rec);
    if (!inQueue.has(id)) {
      queue.push(id);
      inQueue.add(id);
    }
  };

  for (const id of records.keys()) {
    queue.push(id);
    inQueue.add(id);
  }

  let steps = 0;
  const limit = Math.max(64, input.maxDepth) * 4000;

  while (qHead < queue.length && steps < limit) {
    steps++;
    const currentId = queue[qHead++]!;
    inQueue.delete(currentId);
    const current = records.get(currentId);
    if (!current) continue;
    if (current.callChain.length > input.maxDepth) continue;

    // Precise: callers linked by FunctionId
    if (!currentId.startsWith("seed::")) {
      for (const edge of input.callGraph.callers(currentId)) {
        considerEdge(edge, current, input, enqueue, aliasMap);
      }
    }

    // Name-based: seeds and unresolved callees
    for (const label of labelsFor(currentId, current, input.functionGraph)) {
      const edges = edgesByCallee.get(label) ?? [];
      for (const edge of edges) {
        // Skip if already handled via `to` link above
        if (edge.to === currentId) continue;
        considerEdge(edge, current, input, enqueue, aliasMap);
      }
    }
  }

  const wrappers: WrapperInfo[] = [];
  for (const rec of records.values()) {
    if (rec.functionId.startsWith("seed::")) continue;
    const fn = input.functionGraph.get(rec.functionId);
    if (!fn || fn.name === "<module>") continue;
    // Drop pure-circular wrappers that never cleanly reached a seed
    if (rec.circular && rec.confidence < 0.45) continue;
    wrappers.push({
      functionId: rec.functionId,
      name: fn.name,
      absolutePath: fn.absolutePath,
      relativePath: fn.relativePath,
      location: fn.location,
      resolvedTranslationFunction: rec.resolvedTranslationFunction,
      callChain: rec.callChain,
      confidence: round(rec.confidence),
      kind: rec.kind,
      circular: rec.circular,
    });
  }

  wrappers.sort(
    (a, b) =>
      a.absolutePath.localeCompare(b.absolutePath) ||
      a.location.start - b.location.start ||
      a.name.localeCompare(b.name),
  );

  const aliasRecords = [...aliasMap.values()].sort(
    (a, b) =>
      a.absolutePath.localeCompare(b.absolutePath) ||
      a.declPos - b.declPos ||
      a.name.localeCompare(b.name),
  );

  return { records, aliasRecords, wrappers, seedNodes };
}

/** Resolve the best alias at a use site. */
export function findAliasAt(
  aliasRecords: readonly ScopedAliasRecord[],
  absolutePath: string,
  name: string,
  position: number,
): PropagationRecord | undefined {
  let best: ScopedAliasRecord | undefined;
  for (const a of aliasRecords) {
    if (a.absolutePath !== absolutePath || a.name !== name) continue;
    if (position < a.scopeStart || position > a.scopeEnd) continue;
    if (position < a.declPos) continue;
    if (
      !best ||
      a.scopeEnd - a.scopeStart < best.scopeEnd - best.scopeStart ||
      (a.scopeEnd - a.scopeStart === best.scopeEnd - best.scopeStart &&
        a.declPos >= best.declPos)
    ) {
      best = a;
    }
  }
  return best?.record;
}

export function seedLabels(seed: TranslationSeed): string[] {
  const labels: string[] = [];
  if (seed.name) labels.push(seed.name);
  if (seed.member) {
    if (seed.member.object) {
      labels.push(`${seed.member.object}.${seed.member.property}`);
    }
    labels.push(`*.${seed.member.property}`);
  }
  if (seed.hook) {
    labels.push(`${seed.hook}().t`);
    labels.push(seed.hook);
  }
  return labels;
}

function considerEdge(
  edge: CallEdge,
  current: PropagationRecord,
  input: {
    functionGraph: FunctionGraph;
    scopes?: ScopeMetaStore;
  },
  enqueue: (id: FunctionId, rec: PropagationRecord) => void,
  aliasMap: Map<string, ScopedAliasRecord>,
): void {
  if (edge.kind === "assign-alias" && edge.aliasName) {
    const scope = input.scopes?.findLocal(
      edge.absolutePath,
      edge.aliasName,
      edge.location.start,
    );
    const aliasRec: PropagationRecord = {
      functionId: current.functionId,
      resolvedTranslationFunction: current.resolvedTranslationFunction,
      callChain: dedupeChain([edge.aliasName, ...current.callChain]),
      confidence: Math.min(current.confidence, edge.confidence, 0.92),
      kind: "return-alias",
      circular: false,
    };
    const key = `${edge.absolutePath}::${edge.aliasName}@${edge.location.start}`;
    const next: ScopedAliasRecord = {
      absolutePath: edge.absolutePath,
      name: edge.aliasName,
      declPos: edge.location.start,
      scopeStart: scope?.scopeStart ?? 0,
      scopeEnd: scope?.scopeEnd ?? Number.MAX_SAFE_INTEGER,
      record: aliasRec,
    };
    const prev = aliasMap.get(key);
    if (
      !prev ||
      prev.record.confidence < next.record.confidence ||
      prev.record.callChain.length > next.record.callChain.length
    ) {
      aliasMap.set(key, next);
    }
    return;
  }

  const fromFn = input.functionGraph.get(edge.from);
  if (!fromFn || fromFn.name === "<module>") return;

  // Self-recursive / mutual edges must not destroy a clean seed-reaching record.
  const cycle =
    current.callChain.includes(fromFn.name) ||
    current.callChain.includes(fromFn.id);

  if (edge.kind === "call" || edge.kind === "member-call") {
    if (!edge.forwardsKeyParam) return;
    enqueue(edge.from, {
      functionId: edge.from,
      resolvedTranslationFunction: current.resolvedTranslationFunction,
      callChain: dedupeChain([fromFn.name, ...current.callChain]),
      confidence: Math.min(
        current.confidence,
        edge.confidence,
        cycle ? 0.4 : 0.85,
      ),
      kind: current.callChain.length > 1 ? "nested" : "passthrough",
      circular: cycle,
    });
    return;
  }

  if (edge.kind === "return-identity" || edge.kind === "return-member") {
    const kind: WrapperInfo["kind"] =
      edge.calleeName.includes("useTranslation") ||
      edge.calleeName.includes("useTranslations")
        ? "hook-return"
        : "return-alias";
    enqueue(edge.from, {
      functionId: edge.from,
      resolvedTranslationFunction: current.resolvedTranslationFunction,
      callChain: dedupeChain([fromFn.name, ...current.callChain]),
      confidence: Math.min(
        current.confidence,
        edge.confidence,
        cycle ? 0.4 : 0.88,
      ),
      kind,
      circular: cycle,
    });
  }
}

function shouldReplace(
  existing: PropagationRecord,
  next: PropagationRecord,
): boolean {
  // Prefer non-circular over circular
  if (existing.circular && !next.circular) return true;
  if (!existing.circular && next.circular) return false;
  if (next.confidence > existing.confidence) return true;
  if (next.confidence < existing.confidence) return false;
  return next.callChain.length < existing.callChain.length;
}

function labelsFor(
  id: FunctionId,
  rec: PropagationRecord,
  graph: FunctionGraph,
): string[] {
  const out = new Set<string>();
  out.add(rec.resolvedTranslationFunction);
  for (const step of rec.callChain) out.add(step);
  if (id.startsWith("seed::")) {
    out.add(id.slice("seed::".length));
  }
  const fn = graph.get(id);
  if (fn) out.add(fn.name);
  return [...out];
}

function indexEdge(
  map: Map<string, CallEdge[]>,
  key: string,
  edge: CallEdge,
): void {
  const list = map.get(key);
  if (list) {
    if (!list.some((e) => e.id === edge.id)) list.push(edge);
  } else {
    map.set(key, [edge]);
  }
}

function propertyOf(label: string): string {
  if (label.includes("().")) {
    return label.slice(label.lastIndexOf(".") + 1);
  }
  const i = label.lastIndexOf(".");
  return i >= 0 ? label.slice(i + 1) : label;
}

function normalizeTerminal(label: string): string {
  if (label.startsWith("*.")) return label.slice(2);
  if (label.endsWith("().t") || label.endsWith("().$t")) return "t";
  return label;
}

function dedupeChain(chain: string[]): string[] {
  const out: string[] = [];
  for (const step of chain) {
    if (out[out.length - 1] === step) continue;
    out.push(step);
  }
  return out;
}

function zeroLoc() {
  return {
    line: 0,
    column: 0,
    endLine: 0,
    endColumn: 0,
    start: 0,
    end: 0,
  };
}

function round(n: number): number {
  return Math.round(Math.max(0, Math.min(1, n)) * 100) / 100;
}
