/**
 * Resolve default / fallback locales and inheritance chains.
 * Never models runtime locale switching — only static config context.
 *
 * Confidence is independent of namespace resolution: an unresolved locale
 * (common with routing-dynamic apps) does not penalize key/ns confidence.
 */

import type {
  EffectiveI18nSettings,
  LocaleResolveResult,
  LocaleResolver,
  ResolutionSource,
  UsageResolveInput,
} from "../api/types.js";
import { normalizeLocaleToken } from "./extractors/shared.js";
import { roundConfidence } from "./location.js";

const CONF: {
  readonly callSite: number;
  readonly defaultLocale: number;
  readonly unresolved: number;
  readonly unknownSupported: number;
} = {
  callSite: 0.95,
  defaultLocale: 0.85,
  /** Locale not statically known — not a failure. */
  unresolved: 1,
  /** Locale claimed but absent from supportedLocales. */
  unknownSupported: 0.6,
};

export function createLocaleResolver(): LocaleResolver {
  return {
    resolve(input, settings) {
      return resolveLocale(input, settings);
    },
  };
}

export function resolveLocale(
  input: UsageResolveInput,
  settings: EffectiveI18nSettings,
): LocaleResolveResult {
  const chain: ResolutionSource[] = [];

  let locale: string | undefined;
  let source: ResolutionSource = "unknown";
  let confidence: number = CONF.unresolved;

  if (input.locale) {
    locale = normalizeLocaleToken(input.locale);
    source = "call-site";
    chain.push("call-site");
    confidence =
      input.confidence === undefined
        ? CONF.callSite
        : roundConfidence(Math.min(input.confidence, CONF.callSite));
  } else if (settings.defaultLocale) {
    locale = settings.defaultLocale;
    source = "default-locale";
    chain.push("default-locale");
    const cap = Math.min(settings.confidence || 1, CONF.defaultLocale);
    confidence =
      input.confidence === undefined
        ? roundConfidence(cap)
        : roundConfidence(Math.min(input.confidence, cap));
  }

  let fallbackLocale: string | readonly string[] | undefined =
    settings.fallbackLocales;
  if (fallbackLocale !== undefined) {
    chain.push("fallback-locale");
  }

  let inheritanceChain: string[] | undefined;
  if (locale && settings.localeInheritance) {
    inheritanceChain = walkInheritance(locale, settings.localeInheritance);
    if (inheritanceChain.length > 1) {
      chain.push("locale-inheritance");
      if (fallbackLocale === undefined) {
        fallbackLocale = inheritanceChain.slice(1);
        chain.push("fallback-locale");
      }
    }
  }

  if (settings.supportedLocales && settings.supportedLocales.length > 0) {
    chain.push("supported-locales");
    if (locale && !isSupported(locale, settings.supportedLocales)) {
      // Unknown locale vs configured set — keep value, lower confidence
      confidence = roundConfidence(
        Math.min(confidence, CONF.unknownSupported),
      );
    }
  }

  if (chain.length === 0) {
    chain.push("unknown");
  }

  return {
    ...(locale !== undefined ? { locale } : {}),
    ...(fallbackLocale !== undefined ? { fallbackLocale } : {}),
    ...(settings.supportedLocales !== undefined
      ? { supportedLocales: settings.supportedLocales }
      : {}),
    ...(inheritanceChain !== undefined && inheritanceChain.length > 0
      ? { inheritanceChain }
      : {}),
    resolutionSource: source,
    resolutionChain: chain,
    confidence,
  };
}

function isSupported(
  locale: string,
  supported: readonly string[],
): boolean {
  const target = locale.toLowerCase();
  return supported.some((s) => {
    const n = s.toLowerCase();
    return n === target || target.startsWith(n + "-") || n.startsWith(target + "-");
  });
}

function walkInheritance(
  start: string,
  map: Readonly<Record<string, string>>,
  max = 8,
): string[] {
  const chain: string[] = [start];
  const seen = new Set<string>([start.toLowerCase()]);
  let current = start;
  for (let i = 0; i < max; i++) {
    const parent =
      map[current] ??
      map[current.toLowerCase()] ??
      findIgnoreCase(map, current);
    if (!parent) break;
    const key = parent.toLowerCase();
    if (seen.has(key)) break;
    seen.add(key);
    chain.push(parent);
    current = parent;
  }
  return chain;
}

function findIgnoreCase(
  map: Readonly<Record<string, string>>,
  key: string,
): string | undefined {
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(map)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}
