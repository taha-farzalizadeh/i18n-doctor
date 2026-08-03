import { describe, expect, it } from "vitest";
import { createUsageDetector, usageToDiagnostic } from "../src/index.js";
import { fixture } from "./helpers.js";

describe("edge cases", () => {
  it("ignores comments containing translation calls", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/x.tsx": `
import { useTranslation } from 'react-i18next';
export function X() {
  const { t } = useTranslation();
  // t('commented-out')
  /* t('block-comment') */
  return t('real');
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    expect(catalog.usages.map((u) => u.key)).toEqual(["real"]);
  });

  it("ignores plain strings containing t(...)", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/s.tsx": `
import { useTranslation } from 'react-i18next';
export function S() {
  const { t } = useTranslation();
  const docs = "call t('fake') in docs";
  return t('ok') + docs;
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    expect(catalog.usages.map((u) => u.key)).toEqual(["ok"]);
  });

  it("ignores unrelated functions named t", async () => {
    const root = await fixture({
      "src/util.ts": `
function t(x: string) { return x; }
t('not-a-translation');
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    expect(catalog.usages).toEqual([]);
  });

  it("handles JSX attribute usage via t()", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Btn.tsx": `
import { useTranslation } from 'react-i18next';
export function Btn() {
  const { t } = useTranslation();
  return <button title={t('btn.title')}>x</button>;
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const u = catalog.usages.find((x) => x.key === "btn.title");
    expect(u?.context).toBe("function-call");
    expect(u?.location.line).toBe(5);
  });

  it("does not throw on malformed syntax", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/bad.tsx": `
import { useTranslation } from 'react-i18next';
export function Bad() {
  const { t } = useTranslation();
  return t('still-ok'
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    // Best-effort: may or may not recover the key, but must not throw.
    expect(catalog.warnings.every((w) => w.code !== "usage-detect-failed")).toBe(
      true,
    );
  });

  it("handles large files without throwing", async () => {
    const lines = [
      "import { useTranslation } from 'react-i18next';",
      "export function Big() {",
      "  const { t } = useTranslation();",
    ];
    for (let i = 0; i < 2000; i += 1) {
      lines.push(`  const _${i} = ${i};`);
    }
    lines.push("  return t('large.file.key');", "}");
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Big.tsx": lines.join("\n") + "\n",
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const u = catalog.usages.find((x) => x.key === "large.file.key");
    expect(u).toBeDefined();
    expect(u!.location.line).toBeGreaterThan(2000);
  });

  it("returns complete diagnostic fields for every usage", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/D.tsx": `
import { useTranslation } from 'react-i18next';
export function D() {
  const { t } = useTranslation();
  return t('auth.login');
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    for (const usage of catalog.usages) {
      const diag = usageToDiagnostic(usage);
      expect(diag.key).toBeTruthy();
      expect(diag.file).toBe("src/D.tsx");
      expect(diag.absolutePath).toContain("src/D.tsx");
      expect(diag.location).toMatchObject({
        line: expect.any(Number),
        column: expect.any(Number),
        start: expect.any(Number),
        end: expect.any(Number),
      });
      expect(diag.library).toBeTruthy();
      expect(diag.context).toBeTruthy();
      expect(usage.evidence).toContain("detector");
    }
  });

  it("does not treat foo.formatMessage as react-intl without intl binding", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-intl": "6.0.0" },
      }),
      "src/x.ts": `
import { useIntl } from 'react-intl';
export function X() {
  useIntl();
  const foo = { formatMessage: (x: { id: string }) => x.id };
  return foo.formatMessage({ id: 'should-not-match' });
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    expect(catalog.usages.some((u) => u.key === "should-not-match")).toBe(
      false,
    );
  });
});
