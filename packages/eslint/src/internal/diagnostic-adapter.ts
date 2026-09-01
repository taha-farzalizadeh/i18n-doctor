import type { CoverageFileLocation, CoverageResult } from "@i18n-doctor/coverage";
import type { Issue, IssueType } from "@i18n-doctor/issues";
import {
  displayKey,
  fileLocationToEslint,
  issueLocationToEslint,
  type EslintSourceLocation,
} from "./locations.js";
import { RULE_MESSAGES } from "./messages.js";

export interface EslintDiagnostic {
  readonly absolutePath: string;
  readonly loc: EslintSourceLocation;
  readonly messageId: keyof typeof RULE_MESSAGES;
  readonly data: Record<string, string | number>;
  readonly issueType: IssueType | "locale-missing" | "locale-extra";
}

export interface DiagnosticAdapterContext {
  readonly textOf: (absolutePath: string) => string | undefined;
}

export function issueToEslintDiagnostic(
  issue: Issue,
  context: DiagnosticAdapterContext,
): EslintDiagnostic | undefined {
  const absolutePath = issue.location.absolutePath;
  if (!absolutePath) return undefined;

  const text = context.textOf(absolutePath);
  const loc = issueLocationToEslint(issue, text);
  if (!loc) return undefined;

  const namespace = issue.source.namespace ?? issue.location.namespace;
  const display = displayKey(issue.key, namespace);

  switch (issue.type) {
    case "missing-key":
      return {
        absolutePath,
        loc,
        messageId: "missingKey",
        data: { key: display },
        issueType: issue.type,
      };
    case "unused-key":
      if (issue.source.reason === "dynamic-usage") {
        const site = issue.message.match(/src\/[^\s:]+\.tsx?:\d+/)?.[0] ?? "a dynamic call site";
        return {
          absolutePath,
          loc,
          messageId: "unusedKeyDynamic",
          data: { key: display, site },
          issueType: issue.type,
        };
      }
      return {
        absolutePath,
        loc,
        messageId: "unusedKey",
        data: { key: display },
        issueType: issue.type,
      };
    case "duplicate-key": {
      const count = issue.relatedLocations.length + 1;
      const localeSuffix = issue.source.locale
        ? ` in locale "${issue.source.locale}"`
        : "";
      return {
        absolutePath,
        loc,
        messageId: "duplicateKey",
        data: { key: display, count, localeSuffix },
        issueType: issue.type,
      };
    }
    case "untranslated-text":
      return {
        absolutePath,
        loc,
        messageId: "untranslatedText",
        data: { text: display },
        issueType: issue.type,
      };
  }
}

export function coverageMissingToEslintDiagnostic(
  coverage: CoverageResult,
  context: DiagnosticAdapterContext,
): readonly EslintDiagnostic[] {
  const out: EslintDiagnostic[] = [];

  for (const key of coverage.missing) {
    if (key.missingLocales.length === 0) continue;
    const base =
      key.files.find((f) => f.locale === key.baseLocale) ?? key.files[0];
    if (!base?.absolutePath) continue;

    const located = coverageEntryToDiagnostic({
      location: base,
      key: key.key,
      ...(key.namespace !== undefined ? { namespace: key.namespace } : {}),
      messageId: "localeMissing",
      data: {
        key: displayKey(key.key, key.namespace),
        locales: formatLocales(key.missingLocales),
      },
      context,
    });
    if (located) out.push(located);
  }

  for (const extra of coverage.extra) {
    for (const file of extra.files) {
      if (!file.absolutePath) continue;
      const located = coverageEntryToDiagnostic({
        location: file,
        key: extra.key,
        ...(extra.namespace !== undefined ? { namespace: extra.namespace } : {}),
        messageId: "localeExtra",
        data: {
          key: displayKey(extra.key, extra.namespace),
          baseLocale: extra.baseLocale,
        },
        context,
      });
      if (located) out.push(located);
    }
  }

  return out;
}

function coverageEntryToDiagnostic(input: {
  readonly location: CoverageFileLocation;
  readonly key: string;
  readonly namespace?: string;
  readonly messageId: "localeMissing" | "localeExtra";
  readonly data: Record<string, string | number>;
  readonly context: DiagnosticAdapterContext;
}): EslintDiagnostic | undefined {
  const text = input.context.textOf(input.location.absolutePath);
  const loc = fileLocationToEslint(input.location, text, input.key);
  if (!loc) return undefined;

  return {
    absolutePath: input.location.absolutePath,
    loc,
    messageId: input.messageId,
    data: input.data,
    issueType: input.messageId === "localeMissing" ? "locale-missing" : "locale-extra",
  };
}

function formatLocales(locales: readonly string[]): string {
  const quoted = locales.map((l) => `"${l}"`);
  if (quoted.length === 1) return `locale ${quoted[0]}`;
  return `locales ${quoted.join(", ")}`;
}

export function diagnosticSpanId(
  absolutePath: string,
  loc: EslintSourceLocation,
  messageId: string,
): string {
  return [
    absolutePath,
    loc.start.line,
    loc.start.column,
    loc.end.line,
    loc.end.column,
    messageId,
  ].join("\u0000");
}
