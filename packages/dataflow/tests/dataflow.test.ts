import { describe, expect, it } from "vitest";
import { project } from "./helpers.js";

describe("static", () => {
  it('resolves const k = "auth.login"; t(k)', () => {
    const p = project({
      "a.ts": `
const k = "auth.login";
t(k);
`,
    });
    const result = p.analyzeCall("a.ts", "t");
    expect(result.resolved).toBe(true);
    expect(result.possibleKeys).toEqual(["auth.login"]);
    expect(result.analysisType).toBe("variable");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.incomplete).toBe(false);
  });
});

describe("concatenation", () => {
  it('resolves "auth" + "." + "login"', () => {
    const p = project({
      "a.ts": `t("auth" + "." + "login");\n`,
    });
    const result = p.analyzeCall("a.ts", "t");
    expect(result.possibleKeys).toEqual(["auth.login"]);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });
});

describe("template", () => {
  it("resolves `${prefix}.login`", () => {
    const p = project({
      "a.ts": `
const prefix = "auth";
t(\`\${prefix}.login\`);
`,
    });
    expect(p.analyzeCall("a.ts", "t").possibleKeys).toEqual(["auth.login"]);
  });
});

describe("conditions", () => {
  it('resolves condition ? "a" : "b" when known', () => {
    const p = project({
      "a.ts": `
const flag = false;
t(flag ? "a" : "b");
`,
    });
    expect(p.analyzeCall("a.ts", "t").possibleKeys).toEqual(["b"]);
  });

  it("unions both branches when unknown", () => {
    const p = project({
      "a.ts": `t(window.flag ? "a" : "b");\n`,
    });
    const result = p.analyzeCall("a.ts", "t");
    expect(result.possibleKeys).toEqual(["a", "b"]);
    expect(result.analysisType).toBe("conditional");
    expect(result.confidence).toBeLessThanOrEqual(0.7);
  });
});

describe("objects", () => {
  it("resolves keys[name] when name is static", () => {
    const p = project({
      "a.ts": `
const keys = { login: "auth.login", logout: "auth.logout" };
const name = "login";
t(keys[name]);
`,
    });
    expect(p.analyzeCall("a.ts", "t").possibleKeys).toEqual(["auth.login"]);
  });

  it("widens keys[name] when name is unknown", () => {
    const p = project({
      "a.ts": `
const keys = { login: "auth.login", logout: "auth.logout" };
t(keys[dynamicName]);
`,
    });
    const result = p.analyzeCall("a.ts", "t");
    expect(result.possibleKeys).toEqual(["auth.login", "auth.logout"]);
    expect(result.incomplete).toBe(true);
    expect(result.analysisType).toBe("object-lookup");
  });
});

describe("arrays", () => {
  it("resolves keys[index] when index is static", () => {
    const p = project({
      "a.ts": `
const keys = ["auth.login", "auth.logout"];
t(keys[0]);
`,
    });
    expect(p.analyzeCall("a.ts", "t").possibleKeys).toEqual(["auth.login"]);
  });

  it("widens keys[index] when index is unknown", () => {
    const p = project({
      "a.ts": `
const keys = ["auth.login", "auth.logout"];
t(keys[i]);
`,
    });
    const result = p.analyzeCall("a.ts", "t");
    expect(result.possibleKeys).toEqual(["auth.login", "auth.logout"]);
    expect(result.analysisType).toBe("array-lookup");
  });
});

describe("functions", () => {
  it('resolves translate("auth") through section + ".title"', () => {
    const p = project({
      "a.ts": `
function translate(section: string) {
  t(section + ".title");
}
translate("auth");
`,
    });
    const result = p.analyzeCall("a.ts", "t");
    expect(result.possibleKeys).toEqual(["auth.title"]);
    expect(result.resolutionChain.some((s) => s.kind === "parameter")).toBe(
      true,
    );
  });
});
