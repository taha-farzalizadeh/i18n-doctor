import { describe, expect, it } from "vitest";
import type { Issue } from "@i18n-doctor/issues";
import { issueToEslintDiagnostic } from "../src/internal/diagnostic-adapter.js";
import { issueLocationToEslint } from "../src/internal/locations.js";
import { RULE_MESSAGES } from "../src/internal/messages.js";

describe("locations", () => {
  it("maps UTF-16 offsets to ESLint loc covering the key literal", () => {
    const text = 'const x = t("auth.login");\n';
    const issue: Issue = {
      type: "missing-key",
      severity: "error",
      message: 'Missing translation key "auth.login"',
      key: "auth.login",
      location: {
        absolutePath: "/proj/src/Login.tsx",
        relativePath: "src/Login.tsx",
        line: 1,
        column: 12,
        start: 12,
        end: 24,
      },
      relatedLocations: [],
      source: { kind: "usage" },
    };

    const loc = issueLocationToEslint(issue, text);
    expect(loc).toBeDefined();
    expect(text.slice(
      lineOffset(text, loc!.start.line, loc!.start.column),
      lineOffset(text, loc!.end.line, loc!.end.column),
    )).toBe('"auth.login"');

    const diagnostic = issueToEslintDiagnostic(issue, {
      textOf: () => text,
    });
    expect(diagnostic?.messageId).toBe("missingKey");
    expect(RULE_MESSAGES.missingKey).toContain("{{key}}");
  });
});

function lineOffset(text: string, line: number, column: number): number {
  const lines = text.split(/\r\n|\r|\n/);
  let offset = 0;
  for (let i = 0; i < line - 1; i += 1) {
    offset += (lines[i]?.length ?? 0) + 1;
  }
  return offset + column;
}

describe("messages", () => {
  it("uses stable missing-key wording", () => {
    expect(RULE_MESSAGES.missingKey).toBe(
      'Translation key "{{key}}" does not exist.',
    );
  });
});
