import { describe, expect, it } from "vitest";
import { project } from "./helpers.js";

describe("basic", () => {
  it('detects t("key") inside function tr()', () => {
    const p = project({
      "a.ts": `
function tr() {
  t("key");
}
`,
    });
    const result = p.analyzer.analyzeFile({ filePath: p.abs("a.ts") });
    expect(result.wrappers.some((w) => w.name === "tr")).toBe(false);
    const call = result.translationCalls.find((c) => c.key === "key");
    expect(call).toBeDefined();
    expect(call!.calledFunction).toBe("t");
    expect(call!.resolvedTranslationFunction).toBe("t");
    expect(call!.callChain).toEqual(["t"]);
  });

  it("detects key-forwarding function wrappers", () => {
    const p = project({
      "a.ts": `
function tr(k: string) {
  return t(k);
}
tr("hello");
`,
    });
    const result = p.analyzer.analyzeFile({ filePath: p.abs("a.ts") });
    expect(result.wrappers.some((w) => w.name === "tr")).toBe(true);
    const call = result.translationCalls.find((c) => c.key === "hello");
    expect(call!.calledFunction).toBe("tr");
    expect(call!.callChain).toEqual(["tr", "t"]);
    expect(call!.location.line).toBeGreaterThanOrEqual(1);
  });
});

describe("arrow", () => {
  it('detects const tr = () => t("key")', () => {
    const p = project({
      "a.ts": `
const tr = () => t("key");
`,
    });
    const result = p.analyzer.analyzeFile({ filePath: p.abs("a.ts") });
    expect(result.translationCalls.some((c) => c.key === "key")).toBe(true);
  });

  it("detects const tr = (k) => t(k)", () => {
    const p = project({
      "a.ts": `
const tr = (k: string) => t(k);
tr("auth.login");
`,
    });
    const result = p.analyzer.analyzeFile({ filePath: p.abs("a.ts") });
    expect(result.wrappers.some((w) => w.name === "tr")).toBe(true);
    expect(result.translationCalls[0]?.callChain).toEqual(["tr", "t"]);
  });
});

describe("nested", () => {
  it("resolves a -> b -> t", () => {
    const p = project({
      "a.ts": `
function b(k: string) {
  return t(k);
}
function a(k: string) {
  return b(k);
}
a("nested.key");
`,
    });
    const result = p.analyzer.analyzeFile({ filePath: p.abs("a.ts") });
    expect(result.wrappers.map((w) => w.name).sort()).toEqual(["a", "b"]);
    expect(
      result.translationCalls.find((c) => c.key === "nested.key")?.callChain,
    ).toEqual(["a", "b", "t"]);
  });
});

describe("returned functions", () => {
  it("detects return t", () => {
    const p = project({
      "a.ts": `
function createT() {
  return t;
}
const tr = createT();
tr("hello");
`,
    });
    const result = p.analyzer.analyzeFile({ filePath: p.abs("a.ts") });
    expect(result.wrappers.some((w) => w.name === "createT")).toBe(true);
    const call = result.translationCalls.find((c) => c.key === "hello");
    expect(call!.calledFunction).toBe("tr");
    expect(call!.resolvedTranslationFunction).toBe("t");
  });
});

describe("hooks", () => {
  it("detects useAppTranslation()", () => {
    const p = project({
      "a.ts": `
function useAppTranslation() {
  return useTranslation().t;
}
const t = useAppTranslation();
t("hook.key");
`,
    });
    const result = p.analyzer.analyzeFile({ filePath: p.abs("a.ts") });
    const wrapper = result.wrappers.find((w) => w.name === "useAppTranslation");
    expect(wrapper).toBeDefined();
    expect(wrapper!.kind).toBe("hook-return");
    expect(
      result.translationCalls.find((c) => c.key === "hook.key")
        ?.resolvedTranslationFunction,
    ).toBe("t");
  });
});

describe("objects", () => {
  it("detects obj.translate()", () => {
    const p = project({
      "a.ts": `
const obj = {
  translate(k: string) {
    return t(k);
  },
};
obj.translate("obj.key");
`,
    });
    const result = p.analyzer.analyzeFile({ filePath: p.abs("a.ts") });
    expect(result.wrappers.some((w) => w.name === "translate")).toBe(true);
    const call = result.translationCalls.find((c) => c.key === "obj.key");
    expect(call!.calledFunction).toBe("obj.translate");
    expect(call!.resolvedTranslationFunction).toBe("t");
  });
});

describe("cross-file", () => {
  it("follows imported wrappers", () => {
    const p = project({
      "wrappers.ts": `
export function translate(k: string) {
  return t(k);
}
`,
      "app.ts": `
import { translate } from "./wrappers";
translate("cross.file");
`,
    });
    const projectResult = p.analyzer.analyzeFiles([
      p.abs("wrappers.ts"),
      p.abs("app.ts"),
    ]);
    const call = projectResult.translationCalls.find(
      (c) => c.key === "cross.file",
    );
    expect(call!.callChain[0]).toBe("translate");
    expect(call!.resolvedTranslationFunction).toBe("t");
  });
});
