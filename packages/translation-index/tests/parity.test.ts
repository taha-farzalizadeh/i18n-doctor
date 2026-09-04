import { describe, expect, it } from "vitest";
import {
  createIssueEngine,
  definitionsFromCatalog,
  usagesFromCatalog,
} from "@i18n-doctor/issues";
import type { UsageCatalog } from "@i18n-doctor/usages";
import { buildTranslationIndex, matchContextFromOptions } from "../src/index.js";
import { catalog, keyDef } from "./helpers.js";

describe("parity with issue engine", () => {
  it("hasKey agrees with missing-key for the same catalog + usages", () => {
    const sourceCatalog = catalog("/proj", [
      keyDef("SAVE", "locales/en/home.json", "en", {
        namespace: "home",
        value: "Save",
      }),
      keyDef("TITLE", "locales/en/home.json", "en", {
        namespace: "home",
        value: "Home",
      }),
      keyDef("SAVE", "locales/en/settings.json", "en", {
        namespace: "settings",
        value: "Save settings",
      }),
    ]);

    const match = matchContextFromOptions({ matchNamespace: true });
    const index = buildTranslationIndex(sourceCatalog, { matchContext: match });

    const usageCatalog = {
      root: "/proj",
      usages: [
        {
          key: "SAVE",
          absolutePath: "/proj/src/App.tsx",
          relativePath: "src/App.tsx",
          location: {
            line: 2,
            column: 10,
            endLine: 2,
            endColumn: 16,
            start: 0,
            end: 6,
          },
          library: "react-i18next" as const,
          namespace: "home",
          namespaceResolved: true,
          confidence: 1,
          context: "function-call" as const,
        },
        {
          key: "MISSING",
          absolutePath: "/proj/src/App.tsx",
          relativePath: "src/App.tsx",
          location: {
            line: 3,
            column: 10,
            endLine: 3,
            endColumn: 19,
            start: 0,
            end: 9,
          },
          library: "react-i18next" as const,
          namespace: "home",
          namespaceResolved: true,
          confidence: 1,
          context: "function-call" as const,
        },
        {
          key: "SAVE",
          absolutePath: "/proj/src/Settings.tsx",
          relativePath: "src/Settings.tsx",
          location: {
            line: 2,
            column: 10,
            endLine: 2,
            endColumn: 16,
            start: 0,
            end: 6,
          },
          library: "react-i18next" as const,
          namespace: "settings",
          namespaceResolved: true,
          confidence: 1,
          context: "function-call" as const,
        },
      ],
      stats: {
        fileCount: 2,
        usageCount: 3,
        byLibrary: {},
        byContext: {},
      },
      timings: { totalMs: 0, scanMs: 0, detectMs: 0, detectMs: 0 },
      warnings: [],
    } as unknown as UsageCatalog;

    const result = createIssueEngine().analyze({
      root: "/proj",
      definitions: definitionsFromCatalog(sourceCatalog),
      usages: usagesFromCatalog(usageCatalog),
      options: { matchNamespace: true },
    });

    const missingKeys = new Set(
      result.issues.filter((i) => i.type === "missing-key").map((i) => i.key),
    );

    for (const usage of usageCatalog.usages) {
      const exists = index.hasKey({
        key: usage.key,
        ...(usage.namespace !== undefined ? { namespace: usage.namespace } : {}),
        ...(usage.namespaceResolved !== undefined
          ? { namespaceResolved: usage.namespaceResolved }
          : {}),
      });
      expect(exists).toBe(!missingKeys.has(usage.key) || usage.key === "SAVE");
      // SAVE used in home and settings — never missing. MISSING always missing.
      if (usage.key === "MISSING") {
        expect(exists).toBe(false);
        expect(missingKeys.has("MISSING")).toBe(true);
      }
      if (usage.key === "SAVE") {
        expect(exists).toBe(true);
        expect(missingKeys.has("SAVE")).toBe(false);
      }
    }
  });
});
