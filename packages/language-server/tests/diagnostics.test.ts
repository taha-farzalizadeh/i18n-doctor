import { describe, expect, it } from "vitest";
import type { Issue } from "@i18n-doctor/issues";
import { flatProject, LOGIN_TSX } from "./fixtures.js";
import { find, fixture, harness, json, underlined } from "./helpers.js";
import {
  issueToDiagnostic,
  positionAtOffset,
  toRange,
} from "../src/diagnostics.js";
import { DiagnosticSeverity, DIAGNOSTIC_SOURCE } from "../src/protocol.js";

describe("diagnostic shape", () => {
  it("carries severity, message, source, range, and code", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);

    const diagnostic = find(
      h.diagnosticsFor("src/Login.tsx"),
      "missing-key",
      "auth.nonexistent",
    );

    expect(diagnostic).toBeDefined();
    expect(diagnostic?.source).toBe(DIAGNOSTIC_SOURCE);
    expect(diagnostic?.source).toBe("i18n-doctor");
    expect(diagnostic?.code).toBe("missing-key");
    expect(diagnostic?.severity).toBe(DiagnosticSeverity.Error);
    expect(diagnostic?.message).toBe(
      'Translation key "auth.nonexistent" does not exist.',
    );
    expect(diagnostic?.range.start.line).toBe(4);
  });

  it("underlines only the key literal, not the whole file", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);

    const diagnostic = find(
      h.diagnosticsFor("src/Login.tsx"),
      "missing-key",
      "auth.nonexistent",
    );

    expect(diagnostic).toBeDefined();
    expect(underlined(LOGIN_TSX, diagnostic!)).toBe('"auth.nonexistent"');
    expect(diagnostic!.range.start.line).toBe(diagnostic!.range.end.line);
  });

  it("exposes structured data for downstream clients", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);

    const diagnostic = find(
      h.diagnosticsFor("src/Login.tsx"),
      "missing-key",
      "auth.nonexistent",
    );

    expect(diagnostic?.data?.code).toBe("missing-key");
    expect(diagnostic?.data?.key).toBe("auth.nonexistent");
    // The analyzer's own wording is preserved alongside the editor message.
    expect(diagnostic?.data?.analyzerMessage).toContain("Missing translation key");
  });

  it("reports unused keys as warnings tagged unnecessary", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();

    const diagnostic = find(
      h.diagnosticsFor("locales/en.json"),
      "unused-key",
      "auth.logout",
    );

    expect(diagnostic?.severity).toBe(DiagnosticSeverity.Warning);
    expect(diagnostic?.tags).toEqual([1]);
    expect(diagnostic?.message).toBe(
      'Unused translation key "auth.logout" — defined but never used.',
    );
  });

  it("reports keys missing from a non-base locale", async () => {
    const root = await fixture(
      flatProject({
        "locales/fa.json": json({ auth: { login: "ورود" } }),
        "src/Login.tsx": `import { t } from "i18next";
export const L = () => [t("auth.login"), t("auth.logout")];
`,
      }),
    );
    const h = harness(root);
    await h.start();

    const diagnostic = find(
      h.diagnosticsFor("locales/en.json"),
      "missing-translation",
      "auth.logout",
    );

    expect(diagnostic?.severity).toBe(DiagnosticSeverity.Warning);
    expect(diagnostic?.message).toBe(
      'Translation key "auth.logout" is missing in locale "fa".',
    );
    expect(diagnostic?.range.start.line).toBeGreaterThanOrEqual(0);
  });

  it("reports duplicate definitions and links the other definition site", async () => {
    // The same locale defined twice (mid-migration from JSON to TS catalogs).
    const root = await fixture({
      "package.json": json({
        name: "dupes",
        version: "1.0.0",
        dependencies: { i18next: "^23.0.0" },
      }),
      "locales/en.json": json({ auth: { login: "Login" } }),
      "locales/en.ts": `export default {\n  auth: {\n    login: "Sign in",\n  },\n};\n`,
      "src/App.tsx": `import { t } from "i18next";\nexport const A = () => t("auth.login");\n`,
    });
    const h = harness(root);
    await h.start();

    const duplicate = find(
      h.diagnosticsFor("locales/en.json"),
      "duplicate-key",
      "auth.login",
    );

    expect(duplicate).toBeDefined();
    expect(duplicate?.severity).toBe(DiagnosticSeverity.Warning);
    expect(duplicate?.message).toBe(
      'Duplicate translation key "auth.login" defined 2 times in locale "en".',
    );
    expect(duplicate?.relatedInformation?.length).toBe(1);
    expect(duplicate?.relatedInformation?.[0]?.location.uri).toMatch(
      /\/locales\/en\.ts$/,
    );
    expect(duplicate?.relatedInformation?.[0]?.message).toBe(
      "duplicate definition",
    );
  });

  it("underlines the catalog property key, not the translated value", async () => {
    const catalog = json({ auth: { login: "Login", logout: "Log out" } });
    const root = await fixture(flatProject({ "locales/en.json": catalog }));
    const h = harness(root);
    await h.start();

    const diagnostic = find(
      h.diagnosticsFor("locales/en.json"),
      "unused-key",
      "auth.logout",
    );

    expect(diagnostic).toBeDefined();
    expect(underlined(catalog, diagnostic!)).toBe('"logout"');
  });

  it("scopes each diagnostic to the file it belongs to", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);

    // Usage-side findings land in the source file, definition-side in the catalog.
    expect(h.codesFor("src/Login.tsx")).toEqual(["missing-key"]);
    expect(h.codesFor("locales/en.json")).toContain("unused-key");
    expect(h.codesFor("locales/en.json")).not.toContain("missing-key");
  });
});

describe("range mapping", () => {
  const text = 'const a = 1;\nt("auth.login");\nconst b = 2;\n';

  it("prefers exact UTF-16 offsets when the text is available", () => {
    const start = text.indexOf('"auth.login"');
    const result = toRange(
      { line: 2, column: 3, start, end: start + '"auth.login"'.length },
      { text },
    );
    expect(result).toEqual({
      start: { line: 1, character: 2 },
      end: { line: 1, character: 14 },
    });
  });

  it("falls back to end line/column when offsets are absent", () => {
    const result = toRange({
      line: 2,
      column: 3,
      endLine: 2,
      endColumn: 15,
    });
    expect(result).toEqual({
      start: { line: 1, character: 2 },
      end: { line: 1, character: 14 },
    });
  });

  it("locates the key on the line when only a start position exists", () => {
    const result = toRange({ line: 2, column: 1 }, { text, key: "auth.login" });
    expect(result).toEqual({
      start: { line: 1, character: 3 },
      end: { line: 1, character: 13 },
    });
  });

  it("degrades to a single character when the key is not on that line", () => {
    const result = toRange({ line: 1, column: 1 }, { text, key: "auth.login" });
    expect(result).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    });
  });

  it("skips locations that cannot be trusted", () => {
    expect(toRange({ line: 0, column: 1 })).toBeUndefined();
    expect(toRange({ line: 1, column: 0 })).toBeUndefined();
    expect(toRange({ line: -3, column: 4 })).toBeUndefined();
    expect(toRange({ line: 1.5, column: 1 })).toBeUndefined();
  });

  it("ignores offsets that point outside the text", () => {
    const result = toRange(
      { line: 2, column: 3, endLine: 2, endColumn: 15, start: 0, end: 9_999 },
      { text },
    );
    // Falls back to the line/column pair rather than trusting bad offsets.
    expect(result).toEqual({
      start: { line: 1, character: 2 },
      end: { line: 1, character: 14 },
    });
  });

  it("clamps positions to the document bounds", () => {
    const result = toRange(
      { line: 2, column: 3, endLine: 99, endColumn: 400 },
      { text },
    );
    expect(result?.end.line).toBeLessThanOrEqual(3);
  });

  it("ignores an end position that precedes the start", () => {
    const result = toRange({
      line: 5,
      column: 10,
      endLine: 5,
      endColumn: 2,
    });
    expect(result).toEqual({
      start: { line: 4, character: 9 },
      end: { line: 4, character: 10 },
    });
  });

  it("handles CRLF, LF, and lone CR line endings", () => {
    expect(positionAtOffset("a\r\nbb\r\nccc", 3)).toEqual({
      line: 1,
      character: 0,
    });
    expect(positionAtOffset("a\nbb\nccc", 5)).toEqual({
      line: 2,
      character: 0,
    });
    expect(positionAtOffset("a\rbb", 2)).toEqual({ line: 1, character: 0 });
    expect(positionAtOffset("abc", 99)).toEqual({ line: 0, character: 3 });
    expect(positionAtOffset("abc", -5)).toEqual({ line: 0, character: 0 });
  });

  it("drops issues whose location has no usable path", () => {
    const issue: Issue = {
      type: "missing-key",
      severity: "error",
      message: "Missing translation key",
      key: "a.b",
      location: {
        absolutePath: "",
        relativePath: "",
        line: 1,
        column: 1,
      },
      relatedLocations: [],
      source: { kind: "usage" },
    };
    expect(issueToDiagnostic(issue)).toBeUndefined();
  });

  it("drops issues whose location has no usable line", () => {
    const issue: Issue = {
      type: "unused-key",
      severity: "warning",
      message: "Unused translation key",
      key: "a.b",
      location: {
        absolutePath: "/project/locales/en.json",
        relativePath: "locales/en.json",
        line: 0,
        column: 0,
      },
      relatedLocations: [],
      source: { kind: "definition" },
    };
    expect(issueToDiagnostic(issue)).toBeUndefined();
  });
});
