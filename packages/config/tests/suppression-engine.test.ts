import { describe, expect, it } from "vitest";
import { createSuppressionEngine } from "../src/index.js";

describe("SuppressionEngine", () => {
  const engine = createSuppressionEngine();

  function parse(sourceText: string) {
    return engine.parseFile({
      absolutePath: "/x.ts",
      relativePath: "x.ts",
      sourceText,
    });
  }

  it("honors // i18n-unused-ignore on same line", () => {
    const file = parse(`const a = t('a'); // i18n-unused-ignore\n`);
    expect(engine.isSuppressed(file, { line: 1 }).suppressed).toBe(true);
    expect(engine.isSuppressed(file, { line: 1 }).reason).toBe(
      "i18n-unused-ignore",
    );
  });

  it("honors ignore-next-line", () => {
    const file = parse(`/* i18n-unused-ignore-next-line */\nconst a = t('a');\n`);
    expect(engine.isSuppressed(file, { line: 2 }).suppressed).toBe(true);
    expect(engine.isSuppressed(file, { line: 1 }).suppressed).toBe(false);
  });

  it("supports rule-filtered ignore", () => {
    const file = parse(`t('a'); // i18n-unused-ignore unused-key\n`);
    expect(
      engine.isSuppressed(file, { line: 1, rule: "unused-key" }).suppressed,
    ).toBe(true);
    expect(
      engine.isSuppressed(file, { line: 1, rule: "missing-key" }).suppressed,
    ).toBe(false);
  });

  it("supports disable / enable regions", () => {
    const file = parse(`
/* i18n-unused-disable */
const a = t('a');
const b = t('b');
/* i18n-unused-enable */
const c = t('c');
`);
    expect(engine.isSuppressed(file, { line: 3 }).suppressed).toBe(true);
    expect(engine.isSuppressed(file, { line: 4 }).suppressed).toBe(true);
    expect(engine.isSuppressed(file, { line: 6 }).suppressed).toBe(false);
  });

  it("supports rule-specific disable", () => {
    const file = parse(`
/* i18n-unused-disable unused-key */
const a = t('a');
/* i18n-unused-enable unused-key */
const b = t('b');
`);
    expect(
      engine.isSuppressed(file, { line: 3, rule: "unused-key" }).suppressed,
    ).toBe(true);
    expect(
      engine.isSuppressed(file, { line: 3, rule: "missing-key" }).suppressed,
    ).toBe(false);
    expect(
      engine.isSuppressed(file, { line: 5, rule: "unused-key" }).suppressed,
    ).toBe(false);
  });

  it("parses directives deterministically", () => {
    const file = parse(`
// i18n-unused-ignore
/* i18n-unused-ignore-next-line unused-key */
`);
    expect(file.directives.map((d) => d.kind)).toEqual([
      "ignore-line",
      "ignore-next-line",
    ]);
  });

  it("ignores directives inside string literals", () => {
    const file = parse(`const s = "// i18n-unused-ignore";\nt('x');\n`);
    expect(engine.isSuppressed(file, { line: 1 }).suppressed).toBe(false);
    expect(engine.isSuppressed(file, { line: 2 }).suppressed).toBe(false);
  });

  it("does not widen unknown rule filters to all rules", () => {
    const file = parse(`t('a'); // i18n-unused-ignore totally-bogus\n`);
    expect(
      engine.isSuppressed(file, { line: 1, rule: "unused-key" }).suppressed,
    ).toBe(false);
  });
});
