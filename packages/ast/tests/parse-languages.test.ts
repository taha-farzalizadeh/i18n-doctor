import ts from "typescript";
import { describe, expect, it } from "vitest";
import { queryApi, traversalApi } from "../src/index.js";
import { parse } from "./helpers.js";

describe("valid JavaScript", () => {
  it("parses modern JS modules", () => {
    const parsed = parse(
      "src/math.js",
      `
      export const add = (a, b) => a + b;
      export function mul(a, b) { return a * b; }
      const values = [1, 2, ...[3]];
      `,
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.language).toBe("javascript");
    expect(parsed.jsx).toBe("none");
    expect(parsed.diagnostics).toHaveLength(0);
    expect(
      traversalApi.find(parsed.sourceFile, ts.isFunctionDeclaration),
    ).toBeTruthy();
  });

  it("parses mjs/cjs extensions as javascript", () => {
    expect(parse("a.mjs", "export default 1;").language).toBe("javascript");
    expect(parse("a.cjs", "module.exports = 1;").language).toBe("javascript");
  });
});

describe("valid TypeScript", () => {
  it("parses types, enums, and namespaces", () => {
    const parsed = parse(
      "src/model.ts",
      `
      export type Id = string | number;
      export interface User { id: Id; name: string }
      export enum Role { Admin = 1, User = 2 }
      export namespace N { export const x = 1; }
      `,
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.language).toBe("typescript");
    expect(
      traversalApi.find(parsed.sourceFile, ts.isInterfaceDeclaration),
    ).toBeTruthy();
    expect(
      traversalApi.find(parsed.sourceFile, ts.isEnumDeclaration),
    ).toBeTruthy();
  });
});

describe("JSX", () => {
  it("parses JSX in .jsx files", () => {
    const parsed = parse(
      "src/Button.jsx",
      `
      export const Button = ({ label }) => (
        <button className="btn">{label}</button>
      );
      `,
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.jsx).toBe("jsx");
    expect(
      traversalApi.find(parsed.sourceFile, ts.isJsxElement),
    ).toBeTruthy();
  });

  it("parses JSX in .js when jsx mode is forced", () => {
    const parsed = parse("src/legacy.js", `const n = <div />`, { jsx: "jsx" });
    expect(parsed.ok).toBe(true);
    expect(parsed.scriptKind).toBe(ts.ScriptKind.JSX);
  });
});

describe("TSX", () => {
  it("parses typed props and JSX", () => {
    const parsed = parse(
      "src/App.tsx",
      `
      type Props = { title: string };
      export const App = (props: Props) => <h1>{props.title}</h1>;
      `,
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.language).toBe("typescript");
    expect(parsed.jsx).toBe("tsx");
    const loc = queryApi.getLocation(
      parsed.sourceFile,
      traversalApi.find(parsed.sourceFile, ts.isJsxSelfClosingElement) ??
        traversalApi.find(parsed.sourceFile, ts.isJsxElement)!,
    );
    expect(loc.startLine).toBeGreaterThan(0);
  });
});

describe("decorators", () => {
  it("parses experimental-style class and method decorators", () => {
    const parsed = parse(
      "src/service.ts",
      `
      function Injectable(target: any) {}
      function Log(target: any, key: string, desc: PropertyDescriptor) {}

      @Injectable
      export class Service {
        @Log
        run(): void {}
      }
      `,
    );
    expect(parsed.ok).toBe(true);
    const cls = traversalApi.find(parsed.sourceFile, ts.isClassDeclaration);
    expect(cls).toBeTruthy();
    expect(ts.canHaveDecorators(cls!) && !!ts.getDecorators(cls!)).toBe(true);
  });
});

describe("generics", () => {
  it("parses generic functions, classes, and constraints", () => {
    const parsed = parse(
      "src/generic.ts",
      `
      export function identity<T>(value: T): T { return value; }
      export class Box<T extends string | number> {
        constructor(public value: T) {}
      }
      export type Mapped<T> = { [K in keyof T]: T[K] | null };
      `,
    );
    expect(parsed.ok).toBe(true);
    const fn = traversalApi.find(parsed.sourceFile, ts.isFunctionDeclaration);
    expect(fn?.typeParameters?.length).toBe(1);
    const cls = traversalApi.find(parsed.sourceFile, ts.isClassDeclaration);
    expect(cls?.typeParameters?.length).toBe(1);
  });
});
