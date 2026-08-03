import { describe, expect, it } from "vitest";
import ts from "typescript";
import { lastCallArg, project } from "./helpers.js";

describe("basic", () => {
  it('evaluates const a = "hello"; t(a)', () => {
    const p = project({
      "a.ts": `
const a = "hello";
t(a);
`,
    });
    const result = p.evalExpr("a.ts", lastCallArg);
    expect(result.resolved).toBe(true);
    expect(result.value).toBe("hello");
    expect(result.confidence).toBe(0.99);
    expect(result.circular).toBe(false);
  });

  it("evaluates string literals at confidence 1", () => {
    const p = project({ "a.ts": `t("auth.login");\n` });
    const result = p.evalExpr("a.ts", lastCallArg);
    expect(result.resolved).toBe(true);
    expect(result.value).toBe("auth.login");
    expect(result.confidence).toBe(1);
  });
});

describe("concatenation", () => {
  it('evaluates "auth" + "." + "login"', () => {
    const p = project({
      "a.ts": `t("auth" + "." + "login");\n`,
    });
    const result = p.evalExpr("a.ts", lastCallArg);
    expect(result.resolved).toBe(true);
    expect(result.value).toBe("auth.login");
    expect(result.confidence).toBe(1);
    expect(result.resolutionChain.some((s) => s.kind === "concat")).toBe(true);
  });
});

describe("template literals", () => {
  it("evaluates `auth.login`", () => {
    const p = project({ "a.ts": "t(`auth.login`);\n" });
    expect(p.evalExpr("a.ts", lastCallArg).value).toBe("auth.login");
  });

  it("evaluates `${prefix}.login` when prefix is static", () => {
    const p = project({
      "a.ts": `
const prefix = "auth";
t(\`\${prefix}.login\`);
`,
    });
    const result = p.evalExpr("a.ts", lastCallArg);
    expect(result.resolved).toBe(true);
    expect(result.value).toBe("auth.login");
    expect(result.resolutionChain.some((s) => s.kind === "template")).toBe(
      true,
    );
  });
});

describe("objects", () => {
  it("evaluates keys.login", () => {
    const p = project({
      "a.ts": `
const keys = { login: "auth.login" };
t(keys.login);
`,
    });
    const result = p.evalExpr("a.ts", lastCallArg);
    expect(result.resolved).toBe(true);
    expect(result.value).toBe("auth.login");
    expect(result.resolutionChain.some((s) => s.kind === "property")).toBe(
      true,
    );
  });

  it("evaluates imported keys.login", () => {
    const p = project({
      "keys.ts": `export const keys = { login: "auth.login" };\n`,
      "app.ts": `
import { keys } from "./keys";
t(keys.login);
`,
    });
    expect(p.evalExpr("app.ts", lastCallArg).value).toBe("auth.login");
  });

  it("evaluates nested keys.auth.login", () => {
    const p = project({
      "a.ts": `
const keys = { auth: { login: "auth.login" } };
t(keys.auth.login);
`,
    });
    expect(p.evalExpr("a.ts", lastCallArg).value).toBe("auth.login");
  });
});

describe("arrays", () => {
  it("evaluates keys[0]", () => {
    const p = project({
      "a.ts": `
const keys = ["auth.login", "auth.logout"];
t(keys[0]);
`,
    });
    expect(p.evalExpr("a.ts", lastCallArg).value).toBe("auth.login");
  });

  it("evaluates keys[INDEX] when INDEX is a static const", () => {
    const p = project({
      "a.ts": `
const INDEX = 0;
const keys = ["auth.login"];
t(keys[INDEX]);
`,
    });
    expect(p.evalExpr("a.ts", lastCallArg).value).toBe("auth.login");
  });

  it("evaluates a fully static array literal", () => {
    const p = project({
      "a.ts": `const keys = ["a", "b"];\n`,
    });
    const sf = p.parse("a.ts");
    const decl = (sf.statements[0] as ts.VariableStatement).declarationList
      .declarations[0]!;
    const result = p.evaluator.evaluateExpression({
      filePath: p.abs("a.ts"),
      sourceFile: sf,
      expression: decl.initializer!,
    });
    expect(result.resolved).toBe(true);
    expect(result.value).toEqual(["a", "b"]);
  });
});

describe("enums", () => {
  it("evaluates Keys.Login", () => {
    const p = project({
      "a.ts": `
enum Keys {
  Login = "auth.login"
}
t(Keys.Login);
`,
    });
    const result = p.evalExpr("a.ts", lastCallArg);
    expect(result.resolved).toBe(true);
    expect(result.value).toBe("auth.login");
    expect(result.resolutionChain.some((s) => s.kind === "enum")).toBe(true);
  });

  it("evaluates imported string enums", () => {
    const p = project({
      "keys.ts": `
export enum Keys {
  Login = "auth.login"
}
`,
      "app.ts": `
import { Keys } from "./keys";
t(Keys.Login);
`,
    });
    expect(p.evalExpr("app.ts", lastCallArg).value).toBe("auth.login");
  });

  it("does not resolve numeric enums", () => {
    const p = project({
      "a.ts": `
enum Keys { Login }
t(Keys.Login);
`,
    });
    expect(p.evalExpr("a.ts", lastCallArg).resolved).toBe(false);
  });
});

describe("conditionals", () => {
  it('evaluates condition ? "a" : "b" when known', () => {
    const p = project({
      "a.ts": `t(true ? "auth.login" : "other");\n`,
    });
    expect(p.evalExpr("a.ts", lastCallArg).value).toBe("auth.login");

    const p2 = project({
      "a.ts": `
const flag = false;
t(flag ? "a" : "b");
`,
    });
    expect(p2.evalExpr("a.ts", lastCallArg).value).toBe("b");
  });

  it("does not treat string \"true\" as a boolean condition", () => {
    const p = project({
      "a.ts": `
const flag = "true";
t(flag ? "a" : "b");
`,
    });
    expect(p.evalExpr("a.ts", lastCallArg).resolved).toBe(false);
  });

  it("does not resolve unknown conditions", () => {
    const p = project({
      "a.ts": `t(window.x ? "a" : "b");\n`,
    });
    expect(p.evalExpr("a.ts", lastCallArg).resolved).toBe(false);
  });
});

describe("variables", () => {
  it("follows const key = OTHER_CONSTANT", () => {
    const p = project({
      "a.ts": `
const OTHER_CONSTANT = "auth.login";
const key = OTHER_CONSTANT;
t(key);
`,
    });
    expect(p.evalExpr("a.ts", lastCallArg).value).toBe("auth.login");
  });

  it("follows imported constants", () => {
    const p = project({
      "keys.ts": `export const LOGIN = "auth.login";\n`,
      "app.ts": `
import { LOGIN } from "./keys";
t(LOGIN);
`,
    });
    const result = p.evalExpr("app.ts", lastCallArg);
    expect(result.resolved).toBe(true);
    expect(result.value).toBe("auth.login");
    expect(result.resolutionChain.some((s) => s.kind === "import")).toBe(true);
  });

  it("resolves block-scoped consts inside functions", () => {
    const p = project({
      "a.ts": `
function run() {
  const key = "auth.login";
  t(key);
}
`,
    });
    expect(p.evalExpr("a.ts", lastCallArg).value).toBe("auth.login");
  });
});
