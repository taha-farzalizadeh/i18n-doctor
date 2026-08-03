import { describe, expect, it } from "vitest";
import { project } from "./helpers.js";

describe("recursive wrappers", () => {
  it("keeps wrappers that recurse but still reach t", () => {
    const p = project({
      "a.ts": `
function tr(k: string, again = false): string {
  if (again) return tr(k, false);
  return t(k);
}
tr("rec.key");
`,
    });
    const result = p.analyzer.analyzeFile({ filePath: p.abs("a.ts") });
    const wrapper = result.wrappers.find((w) => w.name === "tr");
    expect(wrapper).toBeDefined();
    expect(wrapper!.circular).toBe(false);
    expect(wrapper!.callChain).toEqual(["tr", "t"]);
    expect(
      result.translationCalls.find((c) => c.key === "rec.key")?.callChain,
    ).toEqual(["tr", "t"]);
  });
});

describe("circular calls", () => {
  it("does not hang on a ↔ b without a seed", () => {
    const p = project({
      "a.ts": `
function a(k: string) {
  return b(k);
}
function b(k: string) {
  return a(k);
}
a("x");
`,
    });
    const result = p.analyzer.analyzeFile({ filePath: p.abs("a.ts") });
    expect(result.translationCalls.length).toBe(0);
    expect(result.wrappers.every((w) => w.circular || w.confidence < 0.5)).toBe(
      true,
    );
  });
});

describe("overloaded functions", () => {
  it("uses the implementation body, not overload signatures", () => {
    const p = project({
      "a.ts": `
function tr(k: string): string;
function tr(k: string, opts: object): string;
function tr(k: string, _opts?: object) {
  return t(k);
}
tr("overload.key");
`,
    });
    const result = p.analyzer.analyzeFile({ filePath: p.abs("a.ts") });
    const trs = result.functions.filter((f) => f.name === "tr");
    expect(trs.length).toBe(1);
    expect(result.wrappers.some((w) => w.name === "tr")).toBe(true);
    expect(
      result.translationCalls.find((c) => c.key === "overload.key")?.callChain,
    ).toEqual(["tr", "t"]);
  });
});

describe("same function names in different scopes", () => {
  it("links the innermost wrapper in scope", () => {
    const p = project({
      "a.ts": `
function tr(k: string) {
  return t(k);
}
function outer() {
  function tr(k: string) {
    return t(k);
  }
  tr("inner.key");
}
tr("outer.key");
`,
    });
    const result = p.analyzer.analyzeFile({ filePath: p.abs("a.ts") });
    expect(result.functions.filter((f) => f.name === "tr").length).toBe(2);

    const outerCall = result.translationCalls.find(
      (c) => c.key === "outer.key",
    );
    const innerCall = result.translationCalls.find(
      (c) => c.key === "inner.key",
    );
    expect(outerCall?.callChain).toEqual(["tr", "t"]);
    expect(innerCall?.callChain).toEqual(["tr", "t"]);
    // Distinct function ids behind the same name
    expect(outerCall).toBeDefined();
    expect(innerCall).toBeDefined();
    const trWrappers = result.wrappers.filter((w) => w.name === "tr");
    expect(trWrappers.length).toBe(2);
    expect(trWrappers[0]!.functionId).not.toBe(trWrappers[1]!.functionId);
  });
});

describe("shadowed t()", () => {
  it("does not treat a local t() helper as the i18n seed", () => {
    const p = project({
      "a.ts": `
function t(k: string) {
  return k.toUpperCase();
}
t("not-i18n");
`,
    });
    const result = p.analyzer.analyzeFile({ filePath: p.abs("a.ts") });
    expect(result.translationCalls.length).toBe(0);
    expect(result.wrappers.some((w) => w.name === "t")).toBe(false);
  });

  it("still resolves the seed t when not shadowed", () => {
    const p = project({
      "a.ts": `t("real.key");\n`,
    });
    const result = p.analyzer.analyzeFile({ filePath: p.abs("a.ts") });
    expect(result.translationCalls[0]?.key).toBe("real.key");
  });
});

describe("huge call graphs", () => {
  it("propagates through a long wrapper chain", () => {
    const n = 40;
    const lines: string[] = [
      `function f0(k: string) { return t(k); }`,
    ];
    for (let i = 1; i <= n; i++) {
      lines.push(
        `function f${i}(k: string) { return f${i - 1}(k); }`,
      );
    }
    lines.push(`f${n}("deep.key");`);
    const p = project({ "a.ts": lines.join("\n") });
    const result = p.analyzer.analyzeFile({ filePath: p.abs("a.ts") });
    const call = result.translationCalls.find((c) => c.key === "deep.key");
    expect(call).toBeDefined();
    expect(call!.calledFunction).toBe(`f${n}`);
    expect(call!.resolvedTranslationFunction).toBe("t");
    expect(call!.callChain[0]).toBe(`f${n}`);
    expect(call!.callChain[call!.callChain.length - 1]).toBe("t");
    expect(result.wrappers.length).toBeGreaterThanOrEqual(n);
  });
});

describe("false wrappers", () => {
  it("does not mark non-forwarding helpers as wrappers", () => {
    const p = project({
      "a.ts": `
function log(k: string) {
  console.log(k);
  return t("fixed");
}
log("ignored");
`,
    });
    const result = p.analyzer.analyzeFile({ filePath: p.abs("a.ts") });
    expect(result.wrappers.some((w) => w.name === "log")).toBe(false);
    expect(result.translationCalls.some((c) => c.calledFunction === "log")).toBe(
      false,
    );
    // Inner seed call is still visible
    expect(result.translationCalls.some((c) => c.key === "fixed")).toBe(true);
  });
});

describe("invariants", () => {
  it("is deterministic", () => {
    const p = project({
      "a.ts": `
const tr = (k: string) => t(k);
tr("a");
tr("b");
`,
    });
    const a = p.analyzer.analyzeFile({ filePath: p.abs("a.ts") });
    p.analyzer.clearCache();
    const b = p.analyzer.analyzeFile({ filePath: p.abs("a.ts") });
    expect(a.translationCalls).toEqual(b.translationCalls);
    expect(a.wrappers).toEqual(b.wrappers);
  });

  it("records correct call-site locations", () => {
    const p = project({
      "a.ts": `
const tr = (k: string) => t(k);
tr("loc.key");
`,
    });
    const result = p.analyzer.analyzeFile({ filePath: p.abs("a.ts") });
    const call = result.translationCalls.find((c) => c.key === "loc.key");
    expect(call).toBeDefined();
    expect(call!.location.start).toBeLessThan(call!.location.end);
    expect(call!.location.line).toBeGreaterThanOrEqual(1);
    expect(call!.location.column).toBeGreaterThanOrEqual(1);
  });

  it("does not infinite-loop on pathological recursion", () => {
    const started = Date.now();
    const p = project({
      "a.ts": `
function a(k: string) { return b(k); }
function b(k: string) { return c(k); }
function c(k: string) { return a(k); }
a("x");
`,
    });
    p.analyzer.analyzeFile({ filePath: p.abs("a.ts") });
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
