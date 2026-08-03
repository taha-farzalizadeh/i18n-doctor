import { describe, expect, it } from "vitest";
import { lastCallArg, project } from "./helpers.js";

describe("circular constants", () => {
  it("detects a ↔ b cycles", () => {
    const p = project({
      "a.ts": `
const a = b;
const b = a;
t(a);
`,
    });
    const result = p.evalExpr("a.ts", lastCallArg);
    expect(result.resolved).toBe(false);
    expect(result.circular).toBe(true);
  });

  it("detects self-cycles", () => {
    const p = project({
      "a.ts": `
const a = a;
t(a);
`,
    });
    const result = p.evalExpr("a.ts", lastCallArg);
    expect(result.resolved).toBe(false);
    expect(result.circular).toBe(true);
  });
});

describe("reassignment", () => {
  it("rejects reassigned let", () => {
    const p = project({
      "a.ts": `
let key = "auth.login";
key = "other";
t(key);
`,
    });
    const result = p.evalExpr("a.ts", lastCallArg);
    expect(result.resolved).toBe(false);
  });

  it("rejects += reassignment", () => {
    const p = project({
      "a.ts": `
let key = "auth";
key += ".login";
t(key);
`,
    });
    expect(p.evalExpr("a.ts", lastCallArg).resolved).toBe(false);
  });
});

describe("let variables", () => {
  it("resolves immutable let with a static initializer", () => {
    const p = project({
      "a.ts": `
let key = "auth.login";
t(key);
`,
    });
    const result = p.evalExpr("a.ts", lastCallArg);
    expect(result.resolved).toBe(true);
    expect(result.value).toBe("auth.login");
    expect(result.confidence).toBeLessThanOrEqual(0.9);
  });

  it("rejects let without initializer", () => {
    const p = project({
      "a.ts": `
let key;
key = "auth.login";
t(key);
`,
    });
    expect(p.evalExpr("a.ts", lastCallArg).resolved).toBe(false);
  });
});

describe("undefined variables", () => {
  it("does not resolve missing identifiers", () => {
    const p = project({
      "a.ts": `t(missingKey);\n`,
    });
    const result = p.evalExpr("a.ts", lastCallArg);
    expect(result.resolved).toBe(false);
    expect(result.value).toBeUndefined();
    expect(result.confidence).toBe(0);
  });
});

describe("imported constants", () => {
  it("follows export aliases", () => {
    const p = project({
      "keys.ts": `export const LOGIN = "auth.login";\n`,
      "app.ts": `
import { LOGIN as L } from "./keys";
t(L);
`,
    });
    expect(p.evalExpr("app.ts", lastCallArg).value).toBe("auth.login");
  });

  it("follows default string exports", () => {
    const p = project({
      "keys.ts": `export default "auth.login";\n`,
      "app.ts": `
import LOGIN from "./keys";
t(LOGIN);
`,
    });
    expect(p.evalExpr("app.ts", lastCallArg).value).toBe("auth.login");
  });
});

describe("huge constant graphs", () => {
  it("resolves long alias chains via cache", () => {
    const n = 80;
    const lines: string[] = [`const c0 = "auth.login";`];
    for (let i = 1; i <= n; i++) {
      lines.push(`const c${i} = c${i - 1};`);
    }
    lines.push(`t(c${n});`);
    const p = project({ "a.ts": lines.join("\n") });
    const result = p.evalExpr("a.ts", lastCallArg);
    expect(result.resolved).toBe(true);
    expect(result.value).toBe("auth.login");

    // Second evaluation is cache-identical.
    const again = p.evalExpr("a.ts", lastCallArg);
    expect(again).toEqual(result);
  });

  it("marks depth exhaustion as non-circular", () => {
    const lines: string[] = [`const c0 = "auth.login";`];
    for (let i = 1; i <= 10; i++) {
      lines.push(`const c${i} = c${i - 1};`);
    }
    lines.push(`t(c10);`);
    const p = project({ "a.ts": lines.join("\n") }, { maxDepth: 3 });
    const result = p.evalExpr("a.ts", lastCallArg);
    expect(result.resolved).toBe(false);
    expect(result.circular).toBe(false);
  });
});

describe("unsupported expressions", () => {
  it("never resolves function calls", () => {
    const p = project({ "a.ts": `t(getKey());\n` });
    expect(p.evalExpr("a.ts", lastCallArg).resolved).toBe(false);
  });

  it("never resolves dynamic template parts", () => {
    const p = project({
      "a.ts": `t(\`\${getPrefix()}.login\`);\n`,
    });
    expect(p.evalExpr("a.ts", lastCallArg).resolved).toBe(false);
  });

  it("never resolves boolean / number literals as keys", () => {
    const p = project({ "a.ts": `t(true);\n` });
    expect(p.evalExpr("a.ts", lastCallArg).resolved).toBe(false);

    const p2 = project({ "a.ts": `t(42);\n` });
    expect(p2.evalExpr("a.ts", lastCallArg).resolved).toBe(false);
  });

  it("never resolves object spreads", () => {
    const p = project({
      "a.ts": `
const extra = { login: "auth.login" };
const keys = { ...extra };
t(keys.login);
`,
    });
    expect(p.evalExpr("a.ts", lastCallArg).resolved).toBe(false);
  });

  it("never resolves computed property names", () => {
    const p = project({
      "a.ts": `
const k = "login";
const keys = { [k]: "auth.login" };
t(keys.login);
`,
    });
    expect(p.evalExpr("a.ts", lastCallArg).resolved).toBe(false);
  });
});

describe("invariants", () => {
  it("is deterministic across repeated evaluations", () => {
    const p = project({
      "a.ts": `
const key = "auth" + "." + "login";
t(key);
`,
    });
    const a = p.evalExpr("a.ts", lastCallArg);
    const b = p.evalExpr("a.ts", lastCallArg);
    expect(a).toEqual(b);
  });

  it("records use-site source locations", () => {
    const p = project({
      "a.ts": `
const key = "auth.login";
t(key);
`,
    });
    const sf = p.parse("a.ts");
    const arg = lastCallArg(sf);
    const result = p.evaluator.evaluateExpression({
      filePath: p.abs("a.ts"),
      sourceFile: sf,
      expression: arg,
    });
    expect(result.sourceLocation.start).toBe(arg.getStart(sf));
    expect(result.sourceLocation.end).toBe(arg.getEnd());
    expect(result.sourceLocation.line).toBeGreaterThanOrEqual(1);
  });

  it("builds a meaningful resolution chain", () => {
    const p = project({
      "keys.ts": `export const LOGIN = "auth.login";\n`,
      "app.ts": `
import { LOGIN } from "./keys";
const key = LOGIN;
t(key);
`,
    });
    const result = p.evalExpr("app.ts", lastCallArg);
    const kinds = result.resolutionChain.map((s) => s.kind);
    expect(kinds).toContain("identifier");
    expect(kinds).toContain("declaration");
    expect(kinds).toContain("import");
    expect(kinds).toContain("literal");
  });

  it("records dependency graph bindings with dependsOn", () => {
    const p = project({
      "a.ts": `
const OTHER = "auth.login";
const key = OTHER;
t(key);
`,
    });
    p.evalExpr("a.ts", lastCallArg);
    const binding = p.evaluator
      .getDependencyGraph()
      .bindings.find((b) => b.name === "key");
    expect(binding).toBeDefined();
    expect(binding!.dependsOn).toContain("OTHER");
  });

  it("does not execute runtime code (no side effects from expressions)", () => {
    // If the engine ever eval'd, this would throw. Static failure is required.
    const p = project({
      "a.ts": `
const key = (() => { throw new Error("executed"); })();
t(key);
`,
    });
    expect(p.evalExpr("a.ts", lastCallArg).resolved).toBe(false);
  });

  it("shadowing picks the innermost binding", () => {
    const p = project({
      "a.ts": `
const key = "outer";
function run() {
  const key = "auth.login";
  t(key);
}
`,
    });
    expect(p.evalExpr("a.ts", lastCallArg).value).toBe("auth.login");
  });
});
