import { describe, expect, it } from "vitest";
import { createLocalResolver } from "../src/index.js";
import {
  analyzeSource,
  chainIds,
  resolveCallNamed,
  resolveFirstCall,
} from "./helpers.js";

describe("basic: const tx = t", () => {
  it("resolves tx(\"key\") to t", () => {
    const result = resolveCallNamed(
      `
      const { t } = useTranslation();
      const tx = t;
      tx("key");
    `,
      "tx",
    );
    expect(result.originalIdentifier).toBe("tx");
    expect(result.resolvedIdentifier).toBe("t");
    expect(result.circular).toBe(false);
    expect(result.unresolved).toBe(false);
    expect(chainIds(result)).toEqual(["tx", "t"]);
    expect(result.confidence).toBe(0.95);
    expect(result.location.line).toBeGreaterThan(1);
    expect(result.location.start).toBeGreaterThan(0);
    expect(result.aliasChain[0]?.location?.line).toBeGreaterThan(0);
  });
});

describe("chains: a=t; b=a; c=b", () => {
  it("resolves the full chain to t", () => {
    const result = resolveCallNamed(
      `
      const { t } = useTranslation();
      const a = t;
      const b = a;
      const c = b;
      c("key");
    `,
      "c",
    );
    expect(result.resolvedIdentifier).toBe("t");
    expect(chainIds(result)).toEqual(["c", "b", "a", "t"]);
    expect(result.confidence).toBe(0.95);
  });
});

describe("destructuring: const { t: tr } = useTranslation()", () => {
  it("resolves tr to t", () => {
    const result = resolveCallNamed(
      `
      const { t: tr } = useTranslation();
      tr("key");
    `,
      "tr",
    );
    expect(result.originalIdentifier).toBe("tr");
    expect(result.resolvedIdentifier).toBe("t");
    expect(result.aliasChain[0]?.kind).toBe("destructure");
    expect(result.confidence).toBe(0.9);
  });
});

describe("nested scopes do not leak bindings", () => {
  it("function A's t=x does not alias function B's t(\"key\")", () => {
    const result = resolveCallNamed(
      `
      function A() {
        const t = x;
      }
      function B() {
        t("key");
      }
    `,
      "t",
    );
    // Free `t` in B is a seed — must NOT resolve through A's binding to x.
    expect(result.resolvedIdentifier).toBe("t");
    expect(result.unresolved).toBe(false);
    expect(chainIds(result)).toEqual(["t"]);
    expect(result.aliasChain[0]?.kind).toBe("seed");
  });

  it("inner shadow wins over outer alias", () => {
    const inner = resolveCallNamed(
      `
      const { t } = useTranslation();
      const tx = t;
      function outer() {
        const tx = other;
        tx("inner");
      }
    `,
      "tx",
    );
    expect(inner.resolvedIdentifier).toBe("other");
    expect(inner.unresolved).toBe(true);

    const outer = resolveCallNamed(
      `
      const { t } = useTranslation();
      const tx = t;
      function outer() {
        const tx = other;
      }
      tx("outer");
    `,
      "tx",
    );
    expect(outer.resolvedIdentifier).toBe("t");
    expect(outer.unresolved).toBe(false);
  });

  it("block scope shadowing", () => {
    const source = `
      const { t } = useTranslation();
      const tx = t;
      {
        const tx = other;
        tx("block");
      }
      tx("after");
    `;
    const block = resolveCallNamed(source, "tx", 0);
    const after = resolveCallNamed(source, "tx", 1);
    expect(block.resolvedIdentifier).toBe("other");
    expect(after.resolvedIdentifier).toBe("t");
  });
});

describe("reassignment: let tx = t; tx = other", () => {
  it("uses the nearest preceding assignment", () => {
    const source = `
      let tx = t;
      tx("first");
      tx = other;
      tx("second");
    `;
    const first = resolveCallNamed(source, "tx", 0);
    const second = resolveCallNamed(source, "tx", 1);
    expect(first.resolvedIdentifier).toBe("t");
    expect(first.unresolved).toBe(false);
    expect(second.resolvedIdentifier).toBe("other");
    expect(second.unresolved).toBe(true);
  });

  it("kills the alias when reassigned to a non-alias expression", () => {
    const source = `
      let tx = t;
      tx("first");
      tx = getT();
      tx("second");
    `;
    const first = resolveCallNamed(source, "tx", 0);
    const second = resolveCallNamed(source, "tx", 1);
    expect(first.resolvedIdentifier).toBe("t");
    expect(second.unresolved).toBe(true);
    expect(second.confidence).toBe(0);
  });
});

describe("circular: a=b; b=a", () => {
  it("detects cycles without infinite recursion", () => {
    const result = resolveCallNamed(
      `
      let a = b;
      let b = a;
      a("key");
    `,
      "a",
    );
    expect(result.circular).toBe(true);
    expect(result.confidence).toBe(0);
    expect(result.unresolved).toBe(true);
    expect(result.aliasChain.length).toBeGreaterThan(0);
    expect(result.aliasChain.length).toBeLessThanOrEqual(32);
  });

  it("honors maxChainLength as a hard stop", () => {
    const { sourceFile } = analyzeSource(`
      const a = b;
      const b = a;
      a("x");
    `);
    const resolver = createLocalResolver({ maxChainLength: 2 });
    const analysis = resolver.analyze({ sourceFile });
    const result = resolver.resolve({
      analysis,
      name: "a",
      position: sourceFile.text.indexOf('a("x")'),
    });
    expect(result.circular).toBe(true);
  });

  it("is iterative (stack-safe) for long synthetic cycles", () => {
    const n = 40;
    const decls = Array.from(
      { length: n },
      (_, i) => `const v${i} = v${(i + 1) % n};`,
    ).join("\n");
    const result = resolveCallNamed(
      `
      ${decls}
      v0("key");
    `,
      "v0",
    );
    expect(result.circular).toBe(true);
    expect(result.confidence).toBe(0);
  });
});

describe("wrappers: const tr = (k) => t(k)", () => {
  it("resolves arrow wrappers", () => {
    const result = resolveCallNamed(
      `
      const { t } = useTranslation();
      const tr = (k) => t(k);
      tr("key");
    `,
      "tr",
    );
    expect(result.resolvedIdentifier).toBe("t");
    expect(result.aliasChain[0]?.kind).toBe("wrapper");
    expect(result.confidence).toBe(0.75);
  });

  it("resolves function declaration wrappers", () => {
    const result = resolveCallNamed(
      `
      const { t } = useTranslation();
      function tr(k) { return t(k); }
      tr("key");
    `,
      "tr",
    );
    expect(result.resolvedIdentifier).toBe("t");
    expect(result.aliasChain[0]?.kind).toBe("wrapper");
  });

  it("resolves wrappers to i18n.t", () => {
    const result = resolveCallNamed(
      `
      const tr = (k) => i18n.t(k);
      tr("key");
    `,
      "tr",
    );
    expect(result.resolvedIdentifier).toBe("i18n.t");
    expect(result.resolvedMember).toEqual({ object: "i18n", property: "t" });
  });

  it("does not treat fetch(k) as an i18n wrapper", () => {
    const { analysis } = analyzeSource(`
      const tr = (k) => fetch(k);
      tr("key");
    `);
    expect(analysis.wrappers).toHaveLength(0);
    const result = resolveCallNamed(
      `
      const tr = (k) => fetch(k);
      tr("key");
    `,
      "tr",
    );
    expect(result.unresolved).toBe(true);
  });
});

describe("member aliases", () => {
  it("resolves const translate = i18n.t", () => {
    const result = resolveFirstCall(`
      import i18n from 'i18next';
      const translate = i18n.t;
      translate("hello");
    `);
    expect(result.resolvedIdentifier).toBe("i18n.t");
    expect(result.resolvedMember).toEqual({
      object: "i18n",
      property: "t",
    });
  });
});

describe("determinism and locations", () => {
  it("produces identical results for the same input", () => {
    const source = `
      const { t: tr } = useTranslation();
      const a = tr;
      const b = a;
      b("key");
    `;
    const r1 = resolveCallNamed(source, "b");
    const r2 = resolveCallNamed(source, "b");
    expect(r1).toEqual(r2);
  });

  it("emits deterministic binding order for the same source", () => {
    const source = `
      const z = t;
      const a = t;
      const m = i18n.t;
    `;
    const { analysis: first } = analyzeSource(source);
    const { analysis: second } = analyzeSource(source);
    expect(first.graph.bindings).toEqual(second.graph.bindings);
    // Stable: declaration order (declPos), then name
    expect(first.graph.bindings.map((x) => x.name)).toEqual(["z", "a", "m"]);
  });

  it("keeps declaration locations on chain steps", () => {
    const result = resolveCallNamed(
      `
      const { t: tr } = useTranslation();
      tr("key");
    `,
      "tr",
    );
    expect(result.aliasChain[0]?.location).toMatchObject({
      line: expect.any(Number),
      column: expect.any(Number),
      start: expect.any(Number),
      end: expect.any(Number),
    });
    expect(result.location.end).toBeGreaterThan(result.location.start);
  });
});

describe("confidence scoring", () => {
  it("takes the minimum confidence along the chain", () => {
    const result = resolveCallNamed(
      `
      const { t: tr } = useTranslation();
      const tx = tr;
      const wrap = (k) => tx(k);
      wrap("key");
    `,
      "wrap",
    );
    // wrapper 0.75 is the floor
    expect(result.confidence).toBe(0.75);
    expect(result.resolvedIdentifier).toBe("t");
  });
});

describe("large files", () => {
  it("analyzes and resolves within a large synthetic file without hanging", () => {
    const lines: string[] = [
      "const { t } = useTranslation();",
      "const root = t;",
    ];
    for (let i = 0; i < 2000; i += 1) {
      lines.push(`const alias${i} = root;`);
      lines.push(`function scope${i}() { const shadow${i} = other; shadow${i}("x"); }`);
    }
    lines.push('alias1999("key");');
    const source = lines.join("\n");

    const started = performance.now();
    const result = resolveCallNamed(source, "alias1999");
    const elapsed = performance.now() - started;

    expect(result.resolvedIdentifier).toBe("t");
    expect(result.circular).toBe(false);
    expect(elapsed).toBeLessThan(5000);

    const { analysis } = analyzeSource(source);
    expect(analysis.graph.bindings.length).toBeGreaterThan(2000);
  });
});
