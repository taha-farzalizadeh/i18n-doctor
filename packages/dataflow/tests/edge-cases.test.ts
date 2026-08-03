import { describe, expect, it } from "vitest";
import { project } from "./helpers.js";

describe("circular references", () => {
  it("detects circular variables without hanging", () => {
    const p = project({
      "a.ts": `
const a = b;
const b = a;
t(a);
`,
    });
    const result = p.analyzeCall("a.ts", "t");
    expect(result.resolved).toBe(false);
    expect(result.circular).toBe(true);
  });
});

describe("huge objects", () => {
  it("caps possible keys from oversized object widen", () => {
    const entries = Array.from(
      { length: 120 },
      (_, i) => `k${i}: "key.${i}"`,
    ).join(", ");
    const p = project({
      "a.ts": `
const keys = { ${entries} };
t(keys[dyn]);
`,
    });
    const result = p.analyzeCall("a.ts", "t");
    expect(result.resolved).toBe(true);
    expect(result.possibleKeys.length).toBeLessThanOrEqual(64);
    expect(result.incomplete).toBe(true);
    expect(result.confidence).toBeLessThanOrEqual(0.5);
  });
});

describe("unknown values", () => {
  it("does not invent keys for unknown identifiers", () => {
    const p = project({
      "a.ts": `t(totallyUnknown);\n`,
    });
    const result = p.analyzeCall("a.ts", "t");
    expect(result.resolved).toBe(false);
    expect(result.possibleKeys).toEqual([]);
  });
});

describe("mixed static/dynamic strings", () => {
  it("refuses concat when one side is dynamic", () => {
    const p = project({
      "a.ts": `t("auth." + dynamicPart);\n`,
    });
    const result = p.analyzeCall("a.ts", "t");
    expect(result.resolved).toBe(false);
    expect(result.incomplete).toBe(true);
    expect(result.possibleKeys).toEqual([]);
  });

  it("refuses templates with dynamic holes", () => {
    const p = project({
      "a.ts": "t(`auth.${dyn}.login`);\n",
    });
    const result = p.analyzeCall("a.ts", "t");
    expect(result.resolved).toBe(false);
    expect(result.possibleKeys).toEqual([]);
  });
});

describe("user input", () => {
  it("does not resolve t(userInput)", () => {
    const p = project({
      "a.ts": `t(userInput);\n`,
    });
    const result = p.analyzeCall("a.ts", "t");
    expect(result.resolved).toBe(false);
    expect(result.possibleKeys).toEqual([]);
  });

  it("does not resolve t(event.target.value)", () => {
    const p = project({
      "a.ts": `t(event.target.value);\n`,
    });
    expect(p.analyzeCall("a.ts", "t").resolved).toBe(false);
  });

  it("does not widen object lookup with user-input index", () => {
    const p = project({
      "a.ts": `
const keys = { a: "a", b: "b" };
t(keys[userInput]);
`,
    });
    const result = p.analyzeCall("a.ts", "t");
    expect(result.resolved).toBe(false);
  });
});

describe("value explosion", () => {
  it("caps cartesian concat products", () => {
    const keys = Array.from(
      { length: 30 },
      (_, i) => `k${i}: "p${i}"`,
    ).join(", ");
    const p = project({
      "a.ts": `
const parts = { ${keys} };
function wrap(section: string) {
  t(section + ".title");
}
wrap(parts[dyn]);
`,
    });
    const result = p.analyzeCall("a.ts", "t");
    expect(result.possibleKeys.length).toBeLessThanOrEqual(64);
    expect(result.incomplete).toBe(true);
  });
});

describe("analyzeFile false positives", () => {
  it("does not treat translate(\"auth\") itself as a key", () => {
    const p = project({
      "a.ts": `
function translate(section: string) {
  t(section + ".title");
}
translate("auth");
`,
    });
    const file = p.analyzeFile("a.ts");
    const keys = file.analyses.flatMap((a) => a.possibleKeys);
    expect(keys).toContain("auth.title");
    expect(keys).not.toContain("auth");
  });
});

describe("invariants", () => {
  it("is deterministic", () => {
    const p = project({
      "a.ts": `t(window.x ? "a" : "b");\n`,
    });
    const a = p.analyzeCall("a.ts", "t");
    p.dataflow.clearCache();
    const b = p.analyzeCall("a.ts", "t");
    expect(a).toEqual(b);
  });

  it("never executes runtime code", () => {
    const p = project({
      "a.ts": `
const k = (() => { throw new Error("executed"); })();
t(k);
`,
    });
    expect(p.analyzeCall("a.ts", "t").resolved).toBe(false);
  });

  it("scores single static keys higher than unknown unions", () => {
    const staticP = project({
      "a.ts": `t("auth.login");\n`,
    });
    const unionP = project({
      "a.ts": `t(window.x ? "a" : "b");\n`,
    });
    const s = staticP.analyzeCall("a.ts", "t");
    const u = unionP.analyzeCall("a.ts", "t");
    expect(s.confidence).toBeGreaterThan(u.confidence);
  });

  it("records source locations", () => {
    const p = project({
      "a.ts": `t("auth" + ".login");\n`,
    });
    const result = p.analyzeCall("a.ts", "t");
    expect(result.sourceLocations[0]!.line).toBeGreaterThanOrEqual(1);
    expect(result.resolutionChain.length).toBeGreaterThan(0);
  });
});
