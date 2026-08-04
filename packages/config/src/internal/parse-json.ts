import type { ConfigDiagnostic } from "../api/types.js";
import { validateUserConfig } from "./validate.js";

export function parseJsonConfig(
  text: string,
  path: string,
): ReturnType<typeof validateUserConfig> {
  const diagnostics: ConfigDiagnostic[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (err) {
    diagnostics.push({
      code: "config-json-parse-error",
      severity: "error",
      message: err instanceof Error ? err.message : String(err),
      path,
      hint: "Ensure the file is valid JSON (no comments/trailing commas)",
    });
    return { config: {}, diagnostics };
  }

  // package.json embeds under "i18n-doctor"
  if (
    typeof raw === "object" &&
    raw !== null &&
    !Array.isArray(raw) &&
    "i18n-doctor" in (raw as Record<string, unknown>) &&
    path.endsWith("package.json")
  ) {
    return validateUserConfig((raw as Record<string, unknown>)["i18n-doctor"], path);
  }

  return validateUserConfig(raw, path);
}
