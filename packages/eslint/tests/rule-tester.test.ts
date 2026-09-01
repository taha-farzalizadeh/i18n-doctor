import path from "node:path";
import { RuleTester } from "eslint";
import { describe, expect, it } from "vitest";
import tseslint from "typescript-eslint";
import { noMissingKey } from "../src/rules/no-missing-key.js";
import { ensureWorkerBuilt, resetAnalysisSessions } from "../src/internal/analysis-session.js";
import { DEMO_FIXTURE, writeFixture } from "./helpers.js";

describe("RuleTester async", () => {
  it("reports missing keys", () => {
    resetAnalysisSessions();
    ensureWorkerBuilt();
    const root = writeFixture(DEMO_FIXTURE);
    const file = path.join(root, "src/Login.tsx");
    const code = DEMO_FIXTURE["src/Login.tsx"]!;

    const ruleTester = new RuleTester({
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
    });

    ruleTester.run("no-missing-key", noMissingKey, {
      valid: [],
      invalid: [
        {
          code,
          filename: file,
          errors: [{ messageId: "missingKey" }],
        },
      ],
    });
  });
});
