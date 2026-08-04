import type {
  ConfigFragment,
  ConfigSourceKind,
  EffectiveConfig,
  ExitBehavior,
  OutputConfig,
  RuleConfiguration,
  RuleId,
  RuleSeverity,
  UserConfig,
} from "../api/types.js";
import {
  CONFIG_FILENAMES,
  DEFAULT_OUTPUT,
  DEFAULT_RULE_SEVERITIES,
  DEFAULT_USER_CONFIG,
  RULE_IDS,
} from "./defaults.js";
import { coerceSeverity } from "./severity.js";

const SOURCE_PRIORITY: Record<ConfigSourceKind, number> = {
  defaults: 0,
  "package-json": 1,
  "config-file": 2,
  "package-config": 3,
  cli: 4,
  inline: 5,
};

/**
 * Deterministic merge: higher-priority sources override scalar fields;
 * array fields are replaced (not concatenated) when a source sets them.
 * CLI always wins.
 *
 * Precedence:
 *   defaults < package-json < config-file < package-config < cli
 *
 * Within the same source kind, dedicated config filenames beat package.json,
 * then path localeCompare for stability.
 */
export function mergeFragments(
  root: string,
  packageRoot: string | undefined,
  fragments: readonly ConfigFragment[],
): EffectiveConfig {
  const ranked = [...fragments].sort((a, b) => {
    const diff = SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source];
    if (diff !== 0) return diff;
    const tie = fragmentTieBreak(a) - fragmentTieBreak(b);
    if (tie !== 0) return tie;
    return (a.path ?? "").localeCompare(b.path ?? "");
  });

  const fieldSources: Partial<
    Record<keyof UserConfig | "output.format", ConfigSourceKind>
  > = {};

  let ignoreKeys = [...DEFAULT_USER_CONFIG.ignoreKeys];
  let ignoreFiles = [...DEFAULT_USER_CONFIG.ignoreFiles];
  let ignoreLocales = [...DEFAULT_USER_CONFIG.ignoreLocales];
  let ignoreNamespaces = [...DEFAULT_USER_CONFIG.ignoreNamespaces];
  let include = [...DEFAULT_USER_CONFIG.include];
  let exclude = [...DEFAULT_USER_CONFIG.exclude];
  let exitOnError = DEFAULT_USER_CONFIG.exitOnError;
  let failOnWarning = DEFAULT_USER_CONFIG.failOnWarning;
  let minConfidence = DEFAULT_USER_CONFIG.minConfidence;
  let packages: readonly string[] | undefined;
  let output: Required<OutputConfig> = { ...DEFAULT_OUTPUT };
  const severities: Record<RuleId, RuleSeverity> = {
    ...DEFAULT_RULE_SEVERITIES,
  };

  for (const frag of ranked) {
    const c = frag.config;
    if (c.ignoreKeys !== undefined) {
      ignoreKeys = [...c.ignoreKeys];
      fieldSources.ignoreKeys = frag.source;
    }
    if (c.ignoreFiles !== undefined) {
      ignoreFiles = [...c.ignoreFiles];
      fieldSources.ignoreFiles = frag.source;
    }
    if (c.ignoreLocales !== undefined) {
      ignoreLocales = [...c.ignoreLocales];
      fieldSources.ignoreLocales = frag.source;
    }
    if (c.ignoreNamespaces !== undefined) {
      ignoreNamespaces = [...c.ignoreNamespaces];
      fieldSources.ignoreNamespaces = frag.source;
    }
    if (c.include !== undefined) {
      include = [...c.include];
      fieldSources.include = frag.source;
    }
    if (c.exclude !== undefined) {
      exclude = [...c.exclude];
      fieldSources.exclude = frag.source;
    }
    if (c.exitOnError !== undefined) {
      exitOnError = c.exitOnError;
      fieldSources.exitOnError = frag.source;
    }
    if (c.failOnWarning !== undefined) {
      failOnWarning = c.failOnWarning;
      fieldSources.failOnWarning = frag.source;
    }
    if (c.minConfidence !== undefined) {
      minConfidence = c.minConfidence;
      fieldSources.minConfidence = frag.source;
    }
    if (c.packages !== undefined) {
      packages = [...c.packages];
      fieldSources.packages = frag.source;
    }
    if (c.output !== undefined) {
      output = {
        format: c.output.format ?? output.format,
        file: c.output.file ?? output.file,
        color: c.output.color ?? output.color,
        verbose: c.output.verbose ?? output.verbose,
      };
      if (c.output.format !== undefined) {
        fieldSources["output.format"] = frag.source;
      }
      fieldSources.output = frag.source;
    }
    if (c.rules !== undefined) {
      for (const id of RULE_IDS) {
        const raw = c.rules[id];
        if (raw === undefined) continue;
        const sev = typeof raw === "string" ? raw : coerceSeverity(raw);
        if (sev !== undefined) {
          severities[id] = sev;
        }
      }
      fieldSources.rules = frag.source;
    }
  }

  const rules = createRuleConfiguration(severities);
  const exit = createExitBehavior(exitOnError, failOnWarning);

  const diagnostics = ranked.flatMap((f) => f.diagnostics);
  diagnostics.sort(
    (a, b) =>
      (a.path ?? "").localeCompare(b.path ?? "") ||
      a.code.localeCompare(b.code) ||
      a.message.localeCompare(b.message),
  );

  return {
    root,
    ...(packageRoot !== undefined && packageRoot !== root
      ? { packageRoot }
      : {}),
    ignoreKeys,
    ignoreFiles,
    ignoreLocales,
    ignoreNamespaces,
    include,
    exclude,
    rules,
    exit,
    output,
    ...(packages !== undefined ? { packages } : {}),
    minConfidence,
    fieldSources,
    diagnostics,
    fragments: ranked,
  };
}

/** Higher value wins when source kinds are equal. */
function fragmentTieBreak(f: ConfigFragment): number {
  const base = f.path?.split("/").pop() ?? "";
  if (base === "package.json") return 0;
  if ((CONFIG_FILENAMES as readonly string[]).includes(base)) return 1;
  return 0;
}

export function createRuleConfiguration(
  severities: Readonly<Record<RuleId, RuleSeverity>>,
): RuleConfiguration {
  return {
    severities,
    isEnabled(rule) {
      return severities[rule] !== "off";
    },
    getSeverity(rule) {
      return severities[rule];
    },
  };
}

export function createExitBehavior(
  exitOnError: boolean,
  failOnWarning: boolean,
): ExitBehavior {
  return {
    exitOnError,
    failOnWarning,
    exitCode(counts) {
      if (exitOnError && counts.error > 0) return 1;
      if (failOnWarning && counts.warning > 0) return 1;
      return 0;
    },
  };
}

export function defaultsFragment(): ConfigFragment {
  return {
    source: "defaults",
    config: {
      ignoreKeys: DEFAULT_USER_CONFIG.ignoreKeys,
      ignoreFiles: DEFAULT_USER_CONFIG.ignoreFiles,
      ignoreLocales: DEFAULT_USER_CONFIG.ignoreLocales,
      ignoreNamespaces: DEFAULT_USER_CONFIG.ignoreNamespaces,
      include: DEFAULT_USER_CONFIG.include,
      exclude: DEFAULT_USER_CONFIG.exclude,
      exitOnError: DEFAULT_USER_CONFIG.exitOnError,
      failOnWarning: DEFAULT_USER_CONFIG.failOnWarning,
      minConfidence: DEFAULT_USER_CONFIG.minConfidence,
      rules: { ...DEFAULT_RULE_SEVERITIES },
      output: { ...DEFAULT_OUTPUT },
    },
    diagnostics: [],
  };
}
