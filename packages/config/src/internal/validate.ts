import type {
  ConfigDiagnostic,
  OutputConfig,
  OutputFormat,
  RuleSeverity,
  UserConfig,
} from "../api/types.js";
import { RULE_IDS } from "./defaults.js";
import { coerceSeverity } from "./severity.js";

export { coerceSeverity } from "./severity.js";

const OUTPUT_FORMATS = new Set<OutputFormat>([
  "terminal",
  "json",
  "sarif",
  "github",
  "silent",
]);

/**
 * Validate and normalize a raw config object into UserConfig + diagnostics.
 * Unknown keys produce warnings (never fatal). Invalid types produce errors
 * and the field is dropped.
 */
export function validateUserConfig(
  raw: unknown,
  path?: string,
): { config: UserConfig; diagnostics: ConfigDiagnostic[] } {
  const diagnostics: ConfigDiagnostic[] = [];
  const loc = path;

  if (raw === null || raw === undefined) {
    return { config: {}, diagnostics };
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push({
      code: "config-invalid-root",
      severity: "error",
      message: "Configuration root must be a plain object",
      ...(loc !== undefined ? { path: loc } : {}),
      hint: 'Use `export default { ignoreKeys: ["…"] }` or JSON `{ "ignoreKeys": [] }`',
    });
    return { config: {}, diagnostics };
  }

  const obj = raw as Record<string, unknown>;
  const known = new Set([
    "root",
    "ignoreKeys",
    "ignoreFiles",
    "ignoreLocales",
    "ignoreNamespaces",
    "include",
    "exclude",
    "rules",
    "exitOnError",
    "failOnWarning",
    "output",
    "packages",
    "minConfidence",
    "severities",
  ]);

  for (const key of Object.keys(obj).sort()) {
    if (!known.has(key)) {
      diagnostics.push({
        code: "config-unknown-key",
        severity: "warning",
        message: `Unknown configuration key "${key}"`,
        ...(loc !== undefined ? { path: loc } : {}),
        hint: `Known keys: ${[...known].sort().join(", ")}`,
      });
    }
  }

  const root = readString(obj, "root", diagnostics, loc);
  if (root !== undefined) {
    diagnostics.push({
      code: "config-unused-field",
      severity: "info",
      message: `"root" in config files is ignored; pass root to the resolver/CLI instead`,
      ...(loc !== undefined ? { path: loc } : {}),
    });
  }
  const ignoreKeys = readStringArray(obj, "ignoreKeys", diagnostics, loc);
  const ignoreFiles = readStringArray(obj, "ignoreFiles", diagnostics, loc);
  const ignoreLocales = readStringArray(obj, "ignoreLocales", diagnostics, loc);
  const ignoreNamespaces = readStringArray(
    obj,
    "ignoreNamespaces",
    diagnostics,
    loc,
  );
  const include = readStringArray(obj, "include", diagnostics, loc);
  const exclude = readStringArray(obj, "exclude", diagnostics, loc);
  const packages = readStringArray(obj, "packages", diagnostics, loc);
  const exitOnError = readBoolean(obj, "exitOnError", diagnostics, loc);
  const failOnWarning = readBoolean(obj, "failOnWarning", diagnostics, loc);
  const minConfidence = readNumber(obj, "minConfidence", diagnostics, loc);
  const rules = readRules(obj, diagnostics, loc);
  const output = readOutput(obj, diagnostics, loc);

  const config: UserConfig = {
    ...(ignoreKeys !== undefined ? { ignoreKeys } : {}),
    ...(ignoreFiles !== undefined ? { ignoreFiles } : {}),
    ...(ignoreLocales !== undefined ? { ignoreLocales } : {}),
    ...(ignoreNamespaces !== undefined ? { ignoreNamespaces } : {}),
    ...(include !== undefined ? { include } : {}),
    ...(exclude !== undefined ? { exclude } : {}),
    ...(packages !== undefined ? { packages } : {}),
    ...(exitOnError !== undefined ? { exitOnError } : {}),
    ...(failOnWarning !== undefined ? { failOnWarning } : {}),
    ...(minConfidence !== undefined ? { minConfidence } : {}),
    ...(rules !== undefined ? { rules } : {}),
    ...(output !== undefined ? { output } : {}),
  };

  return { config, diagnostics };
}

function readString(
  obj: Record<string, unknown>,
  key: string,
  diagnostics: ConfigDiagnostic[],
  path?: string,
): string | undefined {
  if (!(key in obj)) return undefined;
  const v = obj[key];
  if (typeof v !== "string") {
    diagnostics.push(typeError(key, "string", path, v));
    return undefined;
  }
  return v;
}

function readBoolean(
  obj: Record<string, unknown>,
  key: string,
  diagnostics: ConfigDiagnostic[],
  path?: string,
): boolean | undefined {
  if (!(key in obj)) return undefined;
  const v = obj[key];
  if (typeof v !== "boolean") {
    diagnostics.push(typeError(key, "boolean", path, v));
    return undefined;
  }
  return v;
}

function readNumber(
  obj: Record<string, unknown>,
  key: string,
  diagnostics: ConfigDiagnostic[],
  path?: string,
): number | undefined {
  if (!(key in obj)) return undefined;
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    diagnostics.push(typeError(key, "number", path, v));
    return undefined;
  }
  if (key === "minConfidence" && (v < 0 || v > 1)) {
    diagnostics.push({
      code: "config-invalid-value",
      severity: "error",
      message: `"minConfidence" must be between 0 and 1 (got ${v})`,
      ...(path !== undefined ? { path } : {}),
    });
    return undefined;
  }
  return v;
}

function readStringArray(
  obj: Record<string, unknown>,
  key: string,
  diagnostics: ConfigDiagnostic[],
  path?: string,
): readonly string[] | undefined {
  if (!(key in obj)) return undefined;
  const v = obj[key];
  if (!Array.isArray(v)) {
    diagnostics.push(typeError(key, "string[]", path, v));
    return undefined;
  }
  // Keep static strings; drop non-strings with a warning (mixed dynamic arrays)
  if (!v.every((x) => typeof x === "string" || x === undefined || x === null)) {
    const nonStrings = v.filter((x) => typeof x !== "string");
    if (nonStrings.length === v.length) {
      diagnostics.push(typeError(key, "string[]", path, v));
      return undefined;
    }
    diagnostics.push({
      code: "config-partial-array",
      severity: "warning",
      message: `"${key}" contains non-string entries that were dropped`,
      ...(path !== undefined ? { path } : {}),
    });
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    if (typeof item !== "string") continue;
    const t = item.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.length > 0 ? out : undefined;
}

function readRules(
  obj: Record<string, unknown>,
  diagnostics: ConfigDiagnostic[],
  path?: string,
): UserConfig["rules"] | undefined {
  if ("rules" in obj && "severities" in obj) {
    diagnostics.push({
      code: "config-duplicate-rules-key",
      severity: "warning",
      message: `Both "rules" and "severities" are set; using "rules" and ignoring "severities"`,
      ...(path !== undefined ? { path } : {}),
    });
  }
  const raw = obj.rules ?? obj.severities;
  if (raw === undefined) return undefined;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    diagnostics.push(typeError("rules", "object", path, raw));
    return undefined;
  }

  const rules: Record<string, RuleSeverity> = {};
  const known = new Set<string>(RULE_IDS);

  for (const [key, value] of Object.entries(
    raw as Record<string, unknown>,
  ).sort(([a], [b]) => a.localeCompare(b))) {
    const normalized = normalizeRuleKey(key);
    if (!known.has(normalized)) {
      diagnostics.push({
        code: "config-unknown-rule",
        severity: "warning",
        message: `Unknown rule "${key}"`,
        ...(path !== undefined ? { path } : {}),
        hint: `Known rules: ${RULE_IDS.join(", ")}`,
      });
      continue;
    }
    const severity = coerceSeverity(value);
    if (severity === undefined) {
      diagnostics.push({
        code: "config-invalid-severity",
        severity: "error",
        message: `Invalid severity for rule "${key}": ${JSON.stringify(value)}`,
        ...(path !== undefined ? { path } : {}),
        hint: 'Use "off" | "info" | "warning" | "error", or boolean',
      });
      continue;
    }
    rules[normalized] = severity;
  }

  return Object.keys(rules).length > 0 ? rules : undefined;
}

function normalizeRuleKey(key: string): string {
  const map: Record<string, string> = {
    unusedKey: "unused-key",
    missingKey: "missing-key",
    duplicateKey: "duplicate-key",
    unused: "unused-key",
    missing: "missing-key",
    duplicate: "duplicate-key",
  };
  return map[key] ?? key;
}

function readOutput(
  obj: Record<string, unknown>,
  diagnostics: ConfigDiagnostic[],
  path?: string,
): OutputConfig | undefined {
  if (!("output" in obj)) return undefined;
  const raw = obj.output;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    diagnostics.push(typeError("output", "object", path));
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  let format: OutputFormat | undefined;
  let file: string | undefined;
  let color: boolean | undefined;
  let verbose: boolean | undefined;

  if ("format" in o) {
    if (
      typeof o.format === "string" &&
      OUTPUT_FORMATS.has(o.format as OutputFormat)
    ) {
      format = o.format as OutputFormat;
    } else {
      diagnostics.push({
        code: "config-invalid-output-format",
        severity: "error",
        message: `Invalid output.format: ${JSON.stringify(o.format)}`,
        ...(path !== undefined ? { path } : {}),
        hint: `Use one of: ${[...OUTPUT_FORMATS].join(", ")}`,
      });
    }
  }
  if ("file" in o) {
    if (typeof o.file === "string") {
      file = o.file;
    } else {
      diagnostics.push(typeError("output.file", "string", path));
    }
  }
  if ("color" in o) {
    if (typeof o.color === "boolean") {
      color = o.color;
    } else {
      diagnostics.push(typeError("output.color", "boolean", path));
    }
  }
  if ("verbose" in o) {
    if (typeof o.verbose === "boolean") {
      verbose = o.verbose;
    } else {
      diagnostics.push(typeError("output.verbose", "boolean", path));
    }
  }

  if (
    format === undefined &&
    file === undefined &&
    color === undefined &&
    verbose === undefined
  ) {
    return undefined;
  }

  return {
    ...(format !== undefined ? { format } : {}),
    ...(file !== undefined ? { file } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(verbose !== undefined ? { verbose } : {}),
  };
}

function typeError(
  key: string,
  expected: string,
  path?: string,
  received?: unknown,
): ConfigDiagnostic {
  const got =
    received === undefined
      ? ""
      : ` (received ${typeof received}${
          typeof received === "string" || typeof received === "number"
            ? `: ${JSON.stringify(received)}`
            : ""
        })`;
  return {
    code: "config-invalid-type",
    severity: "error",
    message: `"${key}" must be of type ${expected}${got}`,
    ...(path !== undefined ? { path } : {}),
  };
}
