import fs from "node:fs";
import type { CoverageResult } from "@i18n-doctor/coverage";
import type { Issue, IssueType } from "@i18n-doctor/issues";
import type { Node } from "estree";
import type { Rule } from "eslint";
import {
  createReadFileOverlay,
  fileMatchesIssuePath,
  getAnalysisSession,
} from "./analysis-session.js";
import {
  coverageMissingToEslintDiagnostic,
  diagnosticSpanId,
  issueToEslintDiagnostic,
  type EslintDiagnostic,
} from "./diagnostic-adapter.js";
import { RULE_MESSAGES, type RuleMessageId } from "./messages.js";

export type I18nRuleKind =
  | "no-missing-key"
  | "no-unused-key"
  | "no-untranslated"
  | "no-duplicate-key"
  | "locale-consistency";

export interface I18nRuleDefinition {
  readonly kind: I18nRuleKind;
  readonly description: string;
  readonly recommendedSeverity: "error" | "warn";
}

const ISSUE_TYPE_BY_KIND: Record<
  Exclude<I18nRuleKind, "locale-consistency">,
  IssueType
> = {
  "no-missing-key": "missing-key",
  "no-unused-key": "unused-key",
  "no-untranslated": "untranslated-text",
  "no-duplicate-key": "duplicate-key",
};

export function createI18nRule(
  definition: I18nRuleDefinition,
): Rule.RuleModule {
  const messageIds = selectMessages(definition.kind);

  return {
    meta: {
      type:
        definition.kind === "no-missing-key" ||
        definition.kind === "no-duplicate-key"
          ? "problem"
          : "suggestion",
      docs: {
        description: definition.description,
        recommended:
          definition.recommendedSeverity === "error" ? "error" : "warn",
      },
      schema: [],
      messages: pickMessages(messageIds),
    },
    create(context) {
      const reported = new Set<string>();

      const onExit = (node: Node) => {
        runRule(context, node, definition, reported);
      };

      return {
        "Program:exit": onExit,
        "Document:exit": onExit,
      };
    },
  };
}

function runRule(
  context: Rule.RuleContext,
  node: Node,
  definition: I18nRuleDefinition,
  reported: Set<string>,
): void {
  const filename = context.filename;
  if (!filename || filename.includes("node_modules")) {
    return;
  }

  const overlay = createReadFileOverlay(
    filename,
    context.sourceCode.getText(),
  );

  const readText = (absolutePath: string): string | undefined => {
    const fromOverlay = overlay(absolutePath);
    if (fromOverlay !== undefined) return fromOverlay;
    try {
      return fs.readFileSync(absolutePath, "utf8");
    } catch {
      return undefined;
    }
  };

  try {
    const snapshot = getAnalysisSession({
      cwd: context.cwd,
      filename,
      readFile: readText,
    });

    const diagnostics = collectDiagnostics(
      definition.kind,
      snapshot.issues,
      snapshot.coverage,
      filename,
      readText,
    );

    for (const diagnostic of diagnostics) {
      const id = diagnosticSpanId(
        diagnostic.absolutePath,
        diagnostic.loc,
        diagnostic.messageId,
      );
      if (reported.has(id)) continue;
      reported.add(id);

      context.report({
        node,
        loc: diagnostic.loc,
        messageId: diagnostic.messageId,
        data: diagnostic.data,
      });
    }
  } catch (error: unknown) {
    context.report({
      node,
      message: `i18n-doctor analysis failed: ${describeError(error)}`,
    });
  }
}

function collectDiagnostics(
  kind: I18nRuleKind,
  issues: readonly Issue[],
  coverage: CoverageResult | undefined,
  filename: string,
  textOf: (absolutePath: string) => string | undefined,
): readonly EslintDiagnostic[] {
  const adapterContext = { textOf };

  if (kind === "locale-consistency") {
    if (!coverage) return [];
    return coverageMissingToEslintDiagnostic(coverage, adapterContext).filter(
      (diagnostic) => fileMatchesIssuePath(filename, diagnostic.absolutePath),
    );
  }

  const issueType =
    ISSUE_TYPE_BY_KIND[kind as Exclude<I18nRuleKind, "locale-consistency">];
  const out: EslintDiagnostic[] = [];

  for (const issue of issues) {
    if (issue.type !== issueType) continue;

    if (fileMatchesIssuePath(filename, issue.location.absolutePath)) {
      const diagnostic = issueToEslintDiagnostic(issue, adapterContext);
      if (diagnostic) out.push(diagnostic);
    }

    if (issueType === "duplicate-key") {
      for (const related of issue.relatedLocations) {
        if (!fileMatchesIssuePath(filename, related.absolutePath)) continue;
        const diagnostic = issueToEslintDiagnostic(
          { ...issue, location: related },
          adapterContext,
        );
        if (diagnostic) out.push(diagnostic);
      }
    }
  }

  return out;
}

function selectMessages(kind: I18nRuleKind): readonly RuleMessageId[] {
  switch (kind) {
    case "no-missing-key":
      return ["missingKey"];
    case "no-unused-key":
      return ["unusedKey", "unusedKeyDynamic"];
    case "no-untranslated":
      return ["untranslatedText"];
    case "no-duplicate-key":
      return ["duplicateKey"];
    case "locale-consistency":
      return ["localeMissing", "localeExtra"];
  }
}

function pickMessages(
  ids: readonly RuleMessageId[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ids) {
    out[id] = RULE_MESSAGES[id];
  }
  return out;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
