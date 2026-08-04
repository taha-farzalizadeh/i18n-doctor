import type { RuleSeverity } from "../api/types.js";
import { SEVERITY_ALIASES } from "./defaults.js";

/** Coerce config / CLI severity values to RuleSeverity. */
export function coerceSeverity(value: unknown): RuleSeverity | undefined {
  if (typeof value === "boolean") {
    return value ? "error" : "off";
  }
  if (typeof value === "number") {
    return SEVERITY_ALIASES[String(value)];
  }
  if (typeof value === "string") {
    return SEVERITY_ALIASES[value.toLowerCase()];
  }
  return undefined;
}
