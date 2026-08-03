import { describe, expect, it } from "vitest";
import { createUsageDetector } from "../src/index.js";
import { fixture } from "./helpers.js";

describe("file-local alias resolution in usages", () => {
  it("detects const tx = t; tx('key')", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Alias.tsx": `
import { useTranslation } from 'react-i18next';
export function A() {
  const { t } = useTranslation();
  const tx = t;
  return tx('aliased.hello');
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const u = catalog.usages.find((x) => x.key === "aliased.hello");
    expect(u).toBeDefined();
    expect(u?.evidence).toContain("alias:");
  });

  it("detects alias chains", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Chain.tsx": `
import { useTranslation } from 'react-i18next';
export function A() {
  const { t } = useTranslation();
  const a = t;
  const b = a;
  const c = b;
  return c('chain.key');
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    expect(catalog.usages.some((x) => x.key === "chain.key")).toBe(true);
  });

  it("detects member aliases const translate = i18n.t", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { i18next: "23.0.0" },
      }),
      "src/Member.ts": `
import i18n from 'i18next';
const translate = i18n.t;
translate('member.key');
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    expect(catalog.usages.some((x) => x.key === "member.key")).toBe(true);
  });

  it("detects simple wrapper functions", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Wrap.tsx": `
import { useTranslation } from 'react-i18next';
export function A() {
  const { t } = useTranslation();
  const tr = (key: string) => t(key);
  return tr('wrap.key');
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    expect(catalog.usages.some((x) => x.key === "wrap.key")).toBe(true);
  });
});
