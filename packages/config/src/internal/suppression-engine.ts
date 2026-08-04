/**
 * Inline suppression directives.
 *
 *   // i18n-doctor-ignore
 *   // i18n-doctor-ignore unused-key
 *   /* i18n-doctor-ignore-next-line *\/
 *   /* i18n-doctor-disable *\/
 *   /* i18n-doctor-enable *\/
 *
 * Directives inside string/template literals are ignored.
 * Unknown rule names never widen to "all rules".
 */

import type { SuppressionEngineFactory } from "../api/resolver.js";
import type {
  RuleId,
  SuppressionDirective,
  SuppressionEngine,
  SuppressionKind,
  SuppressionMatch,
  SuppressionQuery,
} from "../api/types.js";
import { RULE_IDS } from "./defaults.js";

const DIRECTIVE_RE =
  /(?:\/\/|\/\*)\s*i18n-doctor-(ignore-next-line|ignore|disable|enable)\b([^*\n]*?)(?:\*\/|$)/g;

/** Continuations inside multi-line block comments: ` * i18n-doctor-disable` */
const STAR_LINE_RE =
  /^\s*\*\s*i18n-doctor-(ignore-next-line|ignore|disable|enable)\b(.*)$/;

const RULE_SET = new Set<string>(RULE_IDS);

export function createSuppressionEngine(): SuppressionEngine {
  return {
    parseFile(input) {
      return {
        absolutePath: input.absolutePath,
        relativePath: input.relativePath,
        directives: parseDirectives(input.sourceText),
      };
    },
    isSuppressed(file, query) {
      return matchSuppression(file.directives, query);
    },
  };
}

export function parseDirectives(sourceText: string): SuppressionDirective[] {
  const directives: SuppressionDirective[] = [];
  const lines = sourceText.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const lineText = stripStringsAndTemplates(lines[i]!);

    DIRECTIVE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DIRECTIVE_RE.exec(lineText)) !== null) {
      pushDirective(directives, m[1]!, m[2] ?? "", lineNo, m[0]!);
    }

    const star = STAR_LINE_RE.exec(lineText);
    if (star) {
      pushDirective(directives, star[1]!, star[2] ?? "", lineNo, star[0]!);
    }
  }

  directives.sort(
    (a, b) =>
      a.line - b.line ||
      a.kind.localeCompare(b.kind) ||
      a.raw.localeCompare(b.raw),
  );
  return directives;
}

function pushDirective(
  out: SuppressionDirective[],
  kindToken: string,
  rest: string,
  line: number,
  raw: string,
): void {
  const kind = toKind(kindToken);
  if (!kind) return;
  const parsed = parseRules(rest.trim());
  // Tokens present but none valid → inert directive (does not suppress)
  if (parsed.hadTokens && parsed.rules.length === 0) {
    return;
  }
  out.push({
    kind,
    line,
    rules: parsed.rules,
    raw: raw.trim(),
  });
}

/**
 * Replace string / template literal contents with spaces so directive
 * regexes cannot match inside them. Preserves length for column stability.
 */
function stripStringsAndTemplates(line: string): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;

    // Line comment — keep (may contain directive)
    if (ch === "/" && line[i + 1] === "/") {
      out += line.slice(i);
      break;
    }

    // Block comment start — keep through end or EOL
    if (ch === "/" && line[i + 1] === "*") {
      out += "/*";
      i += 2;
      while (i < line.length) {
        out += line[i];
        if (line[i] === "*" && line[i + 1] === "/") {
          out += "/";
          i += 2;
          break;
        }
        i += 1;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      const quote = ch;
      out += " ";
      i += 1;
      while (i < line.length) {
        const c = line[i]!;
        out += " ";
        if (c === "\\" && i + 1 < line.length) {
          out += " ";
          i += 2;
          continue;
        }
        if (c === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    if (ch === "`") {
      out += " ";
      i += 1;
      while (i < line.length) {
        const c = line[i]!;
        out += " ";
        if (c === "\\" && i + 1 < line.length) {
          out += " ";
          i += 2;
          continue;
        }
        if (c === "`") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    out += ch;
    i += 1;
  }
  return out;
}

export function matchSuppression(
  directives: readonly SuppressionDirective[],
  query: SuppressionQuery,
): SuppressionMatch {
  let disabledAll = false;
  const disabledRules = new Set<RuleId>();
  let lastRegion: SuppressionDirective | undefined;

  for (const d of directives) {
    if (d.line > query.line) break;

    if (d.kind === "disable") {
      lastRegion = d;
      if (d.rules.length === 0) {
        disabledAll = true;
        disabledRules.clear();
      } else {
        for (const r of d.rules) disabledRules.add(r);
      }
      continue;
    }

    if (d.kind === "enable") {
      lastRegion = d;
      if (d.rules.length === 0) {
        disabledAll = false;
        disabledRules.clear();
      } else if (disabledAll) {
        disabledAll = false;
        disabledRules.clear();
        for (const r of RULE_IDS) {
          if (!d.rules.includes(r)) disabledRules.add(r);
        }
      } else {
        for (const r of d.rules) disabledRules.delete(r);
      }
    }
  }

  const regionHit =
    disabledAll || (query.rule !== undefined && disabledRules.has(query.rule));
  if (regionHit) {
    return {
      suppressed: true,
      ...(lastRegion !== undefined ? { directive: lastRegion } : {}),
      reason: "i18n-doctor-disable",
    };
  }

  const nextLine = directives.find(
    (d) => d.kind === "ignore-next-line" && d.line === query.line - 1,
  );
  if (nextLine && rulesMatch(nextLine.rules, query.rule)) {
    return {
      suppressed: true,
      directive: nextLine,
      reason: "i18n-doctor-ignore-next-line",
    };
  }

  const sameLine = directives.find(
    (d) => d.kind === "ignore-line" && d.line === query.line,
  );
  if (sameLine && rulesMatch(sameLine.rules, query.rule)) {
    return {
      suppressed: true,
      directive: sameLine,
      reason: "i18n-doctor-ignore",
    };
  }

  return { suppressed: false };
}

function toKind(token: string): SuppressionKind | undefined {
  switch (token) {
    case "ignore":
      return "ignore-line";
    case "ignore-next-line":
      return "ignore-next-line";
    case "disable":
      return "disable";
    case "enable":
      return "enable";
    default:
      return undefined;
  }
}

function parseRules(rest: string): { rules: RuleId[]; hadTokens: boolean } {
  if (!rest) return { rules: [], hadTokens: false };
  const cleaned = rest.replace(/\*\/.*$/, "").trim();
  if (!cleaned) return { rules: [], hadTokens: false };
  const parts = cleaned
    .split(/[,\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return { rules: [], hadTokens: false };

  const out: RuleId[] = [];
  for (const p of parts) {
    const normalized = normalizeRule(p);
    if (normalized && RULE_SET.has(normalized)) {
      out.push(normalized as RuleId);
    }
  }
  return { rules: out, hadTokens: true };
}

function normalizeRule(token: string): string {
  const map: Record<string, string> = {
    unusedKey: "unused-key",
    missingKey: "missing-key",
    duplicateKey: "duplicate-key",
    unused: "unused-key",
    missing: "missing-key",
    duplicate: "duplicate-key",
  };
  return map[token] ?? token;
}

function rulesMatch(
  filter: readonly RuleId[],
  rule: RuleId | undefined,
): boolean {
  if (filter.length === 0) return true;
  if (!rule) return true;
  return filter.includes(rule);
}

export const suppressionEngineFactory: SuppressionEngineFactory = {
  createSuppressionEngine,
};
