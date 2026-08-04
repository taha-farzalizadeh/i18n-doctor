import path from "node:path";
import { describe, expect, it } from "vitest";
import { createIssueEngine } from "../src/index.js";
import type { DefinitionFact, UsageFact } from "../src/api/types.js";

const ROOT = "/tmp/i18n-ns-identity";

function def(
  key: string,
  relativePath: string,
  line: number,
  extra: Partial<DefinitionFact> = {},
): DefinitionFact {
  return {
    key,
    absolutePath: path.join(ROOT, relativePath),
    relativePath,
    line,
    column: 1,
    ...extra,
  };
}

function use(
  key: string,
  relativePath: string,
  line: number,
  extra: Partial<UsageFact> = {},
): UsageFact {
  return {
    key,
    absolutePath: path.join(ROOT, relativePath),
    relativePath,
    line,
    column: 1,
    ...extra,
  };
}

describe("namespace identity (Phase 013.5)", () => {
  it("does not treat home:SAVE and settings:SAVE as duplicates", () => {
    const result = createIssueEngine().analyze({
      root: ROOT,
      definitions: [
        def("SAVE", "home/en.ts", 1, { locale: "en", namespace: "home" }),
        def("SAVE", "settings/en.ts", 1, {
          locale: "en",
          namespace: "settings",
        }),
      ],
      usages: [
        use("SAVE", "Home.tsx", 1, { namespace: "home" }),
        use("SAVE", "Settings.tsx", 1, { namespace: "settings" }),
      ],
    });
    expect(result.stats.duplicateKey).toBe(0);
    expect(result.stats.unusedKey).toBe(0);
  });

  it("marks unused when same key is used in a different namespace", () => {
    const result = createIssueEngine().analyze({
      root: ROOT,
      definitions: [
        def("SAVE", "home/en.ts", 1, { locale: "en", namespace: "home" }),
        def("SAVE", "settings/en.ts", 1, {
          locale: "en",
          namespace: "settings",
        }),
      ],
      usages: [use("SAVE", "Home.tsx", 1, { namespace: "home" })],
    });
    expect(result.stats.unusedKey).toBe(1);
    expect(
      result.issues.find((i) => i.type === "unused-key")?.source.namespace,
    ).toBe("settings");
  });

  it("multi-namespace usage satisfies any listed namespace", () => {
    const result = createIssueEngine().analyze({
      root: ROOT,
      definitions: [
        def("SAVE", "settings/en.ts", 1, {
          locale: "en",
          namespace: "settings",
        }),
      ],
      usages: [
        use("SAVE", "Page.tsx", 1, {
          namespace: "home",
          namespaces: ["home", "settings"],
        }),
      ],
    });
    expect(result.stats.unusedKey).toBe(0);
    expect(result.stats.missingKey).toBe(0);
  });
});
