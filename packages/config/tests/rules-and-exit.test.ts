import { describe, expect, it } from "vitest";
import {
  createExitBehavior,
  createRuleConfiguration,
  validateUserConfig,
} from "../src/index.js";

describe("RuleConfiguration & ExitBehavior", () => {
  it("tracks enabled rules and severities", () => {
    const rules = createRuleConfiguration({
      "unused-key": "off",
      "missing-key": "error",
      "duplicate-key": "warning",
    });
    expect(rules.isEnabled("unused-key")).toBe(false);
    expect(rules.isEnabled("missing-key")).toBe(true);
    expect(rules.getSeverity("duplicate-key")).toBe("warning");
  });

  it("computes exit codes from severity counts", () => {
    const strict = createExitBehavior(true, true);
    expect(strict.exitCode({ error: 0, warning: 0 })).toBe(0);
    expect(strict.exitCode({ error: 1, warning: 0 })).toBe(1);
    expect(strict.exitCode({ error: 0, warning: 1 })).toBe(1);

    const soft = createExitBehavior(true, false);
    expect(soft.exitCode({ error: 0, warning: 5 })).toBe(0);
  });

  it("accepts severity aliases in validation", () => {
    const { config, diagnostics } = validateUserConfig({
      rules: {
        unusedKey: "warn",
        "missing-key": false,
        duplicate: 2,
      },
    });
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(config.rules?.["unused-key"]).toBe("warning");
    expect(config.rules?.["missing-key"]).toBe("off");
    expect(config.rules?.["duplicate-key"]).toBe("error");
  });
});
