/**
 * Resolve translation namespaces and keyPrefix against effective config.
 *
 * react-i18next / i18next priority:
 *   1. options.ns (t(key, { ns }))
 *   2. call-site (useTranslation("auth") / ["auth","common"])
 *   3. inline key "ns:key" (when nsSeparator enabled)
 *   4. defaultNS from config (else implicit "translation")
 *   5. fallbackNS always attached as secondary candidates
 *
 * next-intl:
 *   useTranslations("Dashboard") + keyPrefix + key → nested message path
 *   (NOT an i18next resource namespace). defaultNS / fallbackNS ignored.
 */

import type {
  EffectiveI18nSettings,
  NamespaceResolveResult,
  NamespaceResolver,
  ResolutionSource,
  UsageResolveInput,
} from "../api/types.js";
import { resolutionModeFor } from "./library-mode.js";
import { roundConfidence } from "./location.js";

/** Stable confidence caps by provenance (deterministic). */
const CONF = {
  options: 0.95,
  callSite: 0.92,
  inline: 0.9,
  keyPrefix: 0.93,
  defaultNS: 0.85,
  implicitTranslation: 0.55,
  nextIntl: 0.94,
} as const;

export function createNamespaceResolver(): NamespaceResolver {
  return {
    resolve(input, settings) {
      return resolveNamespace(input, settings);
    },
  };
}

export function resolveNamespace(
  input: UsageResolveInput,
  settings: EffectiveI18nSettings,
): NamespaceResolveResult {
  const mode = resolutionModeFor(input.library);
  if (mode === "next-intl") {
    return resolveNextIntl(input, settings);
  }
  return resolveI18nextFamily(input, settings, mode === "i18next");
}

function resolveNextIntl(
  input: UsageResolveInput,
  settings: EffectiveI18nSettings,
): NamespaceResolveResult {
  const chain: ResolutionSource[] = [];
  const keySeparator = settings.keySeparator || ".";
  const callSiteNs = normalizeNs(input.callSiteNamespace);
  const keyPrefix = input.keyPrefix?.trim() || undefined;

  // Messages namespace is a key-path prefix (may be nested: "Dashboard.Chart")
  const messagesPrefix = callSiteNs?.[0];
  if (messagesPrefix) {
    chain.push("call-site");
  }
  if (keyPrefix) {
    chain.push("key-prefix");
  }
  if (chain.length === 0) {
    chain.push("unknown");
  }

  const resolvedKey = joinKeyParts(
    [messagesPrefix, keyPrefix, input.key],
    keySeparator,
  );

  const confidence = scoreConfidence(
    input.confidence,
    messagesPrefix || keyPrefix ? CONF.nextIntl : 0.7,
  );

  return {
    ...(messagesPrefix !== undefined ? { namespace: messagesPrefix } : {}),
    ...(callSiteNs && callSiteNs.length > 1 ? { namespaces: callSiteNs } : {}),
    ...(keyPrefix !== undefined ? { keyPrefix } : {}),
    resolvedKey,
    originalKey: input.key,
    resolutionSource: messagesPrefix
      ? "call-site"
      : keyPrefix
        ? "key-prefix"
        : "unknown",
    resolutionChain: chain,
    confidence,
  };
}

function resolveI18nextFamily(
  input: UsageResolveInput,
  settings: EffectiveI18nSettings,
  applyImplicitTranslation: boolean,
): NamespaceResolveResult {
  const chain: ResolutionSource[] = [];
  const keySeparator = settings.keySeparator || ".";
  // Empty string disables inline ns splitting (nsSeparator: false)
  const nsSeparator = settings.nsSeparator;
  const inlineEnabled = nsSeparator.length > 0;

  let keyBody = input.key;
  let namespace: string | undefined;
  let namespaces: string[] | undefined;
  let source: ResolutionSource = "unknown";
  let confidence = scoreConfidence(input.confidence, 0.7);

  // Priority: options.ns > call-site > inline > defaultNS
  // (inline checked after call-site so useTranslation("auth") + t("ns:key")
  //  still prefers binding ns unless options override — matching i18next:
  //  options.ns wins; bare "ns:key" is used when no binding ns.)

  const optionsNs = normalizeNs(input.optionsNamespace);
  if (optionsNs) {
    namespace = optionsNs[0];
    namespaces = optionsNs.length > 1 ? optionsNs : undefined;
    source = "options";
    chain.push("options");
    confidence = scoreConfidence(input.confidence, CONF.options);
  }

  const callSiteNs = normalizeNs(input.callSiteNamespace);
  if (!namespace && callSiteNs) {
    namespace = callSiteNs[0];
    namespaces = callSiteNs.length > 1 ? callSiteNs : undefined;
    source = "call-site";
    chain.push("call-site");
    confidence = scoreConfidence(input.confidence, CONF.callSite);
  }

  if (!namespace && inlineEnabled) {
    const inline = splitInlineNamespace(input.key, nsSeparator);
    if (inline) {
      namespace = inline.namespace;
      keyBody = inline.key;
      source = "call-site";
      chain.push("call-site");
      confidence = scoreConfidence(input.confidence, CONF.inline);
    }
  }

  if (!namespace && settings.defaultNS !== undefined) {
    namespace = settings.defaultNS;
    source = "defaultNS";
    chain.push("defaultNS");
    confidence = scoreConfidence(
      input.confidence,
      Math.min(settings.confidence || 1, CONF.defaultNS),
    );
  }

  // i18next implicit default — never use ns[0] / resources order
  if (!namespace && applyImplicitTranslation) {
    namespace = "translation";
    source = "defaultNS";
    chain.push("defaultNS");
    confidence = scoreConfidence(input.confidence, CONF.implicitTranslation);
  }

  // fallbackNS: secondary candidates for ANY primary namespace (i18next semantics)
  const fallback = normalizeNs(settings.fallbackNS);
  if (namespace && fallback && fallback.length > 0) {
    const merged = unique([namespace, ...(namespaces ?? []), ...fallback]);
    if (merged.length > 1) {
      namespaces = merged;
      if (!chain.includes("fallbackNS")) {
        chain.push("fallbackNS");
      }
    }
  } else if (!namespace && fallback && fallback.length > 0) {
    // No primary — surface fallbackNS as candidates only
    namespace = fallback[0];
    namespaces = fallback.length > 1 ? fallback : undefined;
    source = "fallbackNS";
    chain.push("fallbackNS");
    confidence = scoreConfidence(input.confidence, 0.5);
  }

  // Deduplicate multi-ns lists (duplicate namespace edge case)
  if (namespaces) {
    namespaces = unique(namespaces);
    if (namespaces.length === 1 && namespaces[0] === namespace) {
      namespaces = undefined;
    }
  }

  let resolvedKey = keyBody;
  const keyPrefix = input.keyPrefix?.trim() || undefined;
  if (keyPrefix) {
    chain.push("key-prefix");
    resolvedKey = joinKeyParts([keyPrefix, keyBody], keySeparator);
    confidence = roundConfidence(Math.min(confidence, CONF.keyPrefix));
    if (source === "unknown") {
      source = "key-prefix";
    }
  }

  if (chain.length === 0) {
    chain.push("unknown");
  }

  return {
    ...(namespace !== undefined ? { namespace } : {}),
    ...(namespaces !== undefined ? { namespaces } : {}),
    ...(keyPrefix !== undefined ? { keyPrefix } : {}),
    resolvedKey,
    originalKey: input.key,
    resolutionSource: source,
    resolutionChain: chain,
    confidence,
  };
}

function joinKeyParts(
  parts: readonly (string | undefined)[],
  separator: string,
): string {
  const sep = separator.length > 0 ? separator : ".";
  const cleaned: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    let p = part;
    while (p.startsWith(sep)) p = p.slice(sep.length);
    while (p.endsWith(sep)) p = p.slice(0, -sep.length);
    if (p.length > 0) cleaned.push(p);
  }
  return cleaned.join(sep);
}

function normalizeNs(
  value: string | readonly string[] | undefined,
): string[] | undefined {
  if (value === undefined) return undefined;
  const list = typeof value === "string" ? [value] : [...value];
  const cleaned = unique(
    list.map((s) => s.trim()).filter((s) => s.length > 0),
  );
  return cleaned.length > 0 ? cleaned : undefined;
}

function splitInlineNamespace(
  key: string,
  nsSeparator: string,
): { namespace: string; key: string } | undefined {
  if (!nsSeparator || nsSeparator.length === 0) {
    return undefined;
  }
  const idx = key.indexOf(nsSeparator);
  if (idx <= 0) {
    return undefined;
  }
  const ns = key.slice(0, idx);
  const rest = key.slice(idx + nsSeparator.length);
  // Namespace tokens: short identifiers (no spaces / ICU braces)
  if (!/^[A-Za-z0-9_.@/-]+$/.test(ns) || rest.length === 0) {
    return undefined;
  }
  // Avoid splitting ICU-like "count: one {..} other {..}" — require key-ish rest
  if (rest.includes("{") && !rest.includes(".")) {
    return undefined;
  }
  return { namespace: ns, key: rest };
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/**
 * Stable confidence: provenance cap is the score unless the caller
 * supplied a lower explicit confidence.
 */
function scoreConfidence(
  inputConfidence: number | undefined,
  cap: number,
): number {
  if (inputConfidence === undefined) {
    return roundConfidence(cap);
  }
  return roundConfidence(Math.min(inputConfidence, cap));
}
