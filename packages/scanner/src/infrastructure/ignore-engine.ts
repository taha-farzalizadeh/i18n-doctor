import type { IgnoreExplanation, IgnoreRule } from "../domain/ignore.js";
import type { RelativePosixPath } from "../domain/paths.js";
import { asRelativePosixPath } from "../domain/brands.js";
import type { IgnoreEngineFactory, IgnoreEnginePort } from "../ports/ignore-engine.js";

interface CompiledRule {
  readonly rule: IgnoreRule;
  /** Empty string means workspace root. */
  readonly base: string;
  readonly directoryOnly: boolean;
  readonly regex: RegExp;
}

/**
 * gitignore-compatible matcher with last-match-wins and directory pruning support.
 */
export class IgnoreEngine implements IgnoreEnginePort {
  private readonly compiled: CompiledRule[] = [];
  private readonly layerSizes: number[] = [];

  constructor(rules: readonly IgnoreRule[] = [], base = "") {
    this.addRules(rules, base);
  }

  get rules(): readonly IgnoreRule[] {
    return this.compiled.map((c) => c.rule);
  }

  addRules(rules: readonly IgnoreRule[], base = ""): void {
    for (const rule of rules) {
      const compiled = compileRule(rule, base);
      if (compiled) {
        this.compiled.push(compiled);
      }
    }
  }

  pushLayer(rules: readonly IgnoreRule[], base = ""): void {
    this.layerSizes.push(this.compiled.length);
    this.addRules(rules, base);
  }

  popLayer(): void {
    const start = this.layerSizes.pop();
    if (start === undefined) {
      return;
    }
    this.compiled.length = start;
  }

  isIgnored(path: RelativePosixPath, isDirectory: boolean): boolean {
    return this.decision(path, isDirectory).ignored;
  }

  explain(path: RelativePosixPath): IgnoreExplanation {
    const decision = this.decision(path, false);
    const dirDecision = this.decision(path, true);
    const ignored = decision.ignored || dirDecision.ignored;
    const matched = decision.matched ?? dirDecision.matched;
    return {
      path,
      ignored,
      matchedRule: matched?.rule,
      layers: this.compiled.map((c) => c.rule),
    };
  }

  private decision(
    path: RelativePosixPath,
    isDirectory: boolean,
  ): { ignored: boolean; matched: CompiledRule | undefined } {
    if (path === "") {
      return { ignored: false, matched: undefined };
    }

    let ignored = false;
    let matched: CompiledRule | undefined;

    for (const rule of this.compiled) {
      if (matchesCompiled(rule, path, isDirectory)) {
        ignored = !rule.rule.negated;
        matched = rule;
      }
    }

    return { ignored, matched };
  }
}

export const ignoreEngineFactory: IgnoreEngineFactory = {
  create(rules: readonly IgnoreRule[]): IgnoreEnginePort {
    return new IgnoreEngine(rules);
  },
};

export function parseGitignoreContent(
  content: string,
  source: IgnoreRule["source"] = "gitignore",
): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    let pattern = line;
    let negated = false;
    if (pattern.startsWith("!")) {
      negated = true;
      pattern = pattern.slice(1);
    }
    if (pattern.length === 0) {
      continue;
    }
    rules.push({ pattern, source, negated });
  }
  return rules;
}

function compileRule(rule: IgnoreRule, base: string): CompiledRule | undefined {
  let pattern = rule.pattern;
  if (pattern.length === 0) {
    return undefined;
  }

  let directoryOnly = false;
  if (pattern.endsWith("/")) {
    directoryOnly = true;
    pattern = pattern.slice(0, -1);
  }

  if (pattern.startsWith("/")) {
    pattern = pattern.slice(1);
  }

  const regex = gitignorePatternToRegExp(pattern);
  return {
    rule,
    base: trimSlashes(base),
    directoryOnly,
    regex,
  };
}

function matchesCompiled(
  rule: CompiledRule,
  path: RelativePosixPath,
  isDirectory: boolean,
): boolean {
  let relative = path;
  if (rule.base.length > 0) {
    if (path !== rule.base && !path.startsWith(`${rule.base}/`)) {
      return false;
    }
    relative = asRelativePosixPath(
      path === rule.base ? "" : path.slice(rule.base.length + 1),
    );
  }

  if (relative === "") {
    return false;
  }

  if (rule.directoryOnly && !isDirectory) {
    return false;
  }

  if (rule.regex.test(relative)) {
    return true;
  }

  // Unanchored basename-style: also try each suffix
  const segments = relative.split("/");
  for (let i = 1; i < segments.length; i += 1) {
    const suffix = segments.slice(i).join("/");
    if (rule.regex.test(suffix)) {
      return true;
    }
  }
  return false;
}

function gitignorePatternToRegExp(pattern: string): RegExp {
  let source = "^";
  const parts = pattern.split("/");

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i] ?? "";
    if (part === "**") {
      if (i === parts.length - 1) {
        source += i === 0 ? ".*" : "(?:/.*)?";
      } else {
        source += "(?:.*/)?";
      }
      continue;
    }
    if (i > 0 && parts[i - 1] !== "**") {
      source += "/";
    }
    source += globSegmentToRegExp(part);
  }

  source += "$";
  return new RegExp(source);
}

function globSegmentToRegExp(segment: string): string {
  let out = "";
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i]!;
    if (ch === "*") {
      out += "[^/]*";
    } else if (ch === "?") {
      out += "[^/]";
    } else if ("+.^${}()|[]\\".includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  return out;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}
