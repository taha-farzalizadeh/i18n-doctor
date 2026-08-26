import { describe, expect, it } from "vitest";
import { createUsageDetector } from "../src/index.js";
import { fixture } from "./helpers.js";

describe("prop-passed t", () => {
  it("detects t(\"key\") when t is destructured from props", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Child.tsx": `
export function Child({ t }: { t: (key: string) => string }) {
  return <span>{t('child.from.props')}</span>;
}
`,
      "src/Parent.tsx": `
import { useTranslation } from 'react-i18next';
import { Child } from './Child';
export function Parent() {
  const { t } = useTranslation();
  return <Child t={t} />;
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const keys = catalog.usages.map((u) => u.key);
    expect(keys).toContain("child.from.props");
    const u = catalog.usages.find((x) => x.key === "child.from.props");
    expect(u?.evidence).toContain("props");
  });

  it("detects renamed prop { t: translate }", async () => {
    const root = await fixture({
      "src/X.tsx": `
export function X({ t: translate }) {
  return translate('renamed.prop.key');
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    expect(catalog.usages.map((u) => u.key)).toContain("renamed.prop.key");
  });

  it("detects props.t(\"key\") when props is typed with t", async () => {
    const root = await fixture({
      "src/Y.tsx": `
type Props = { t: (k: string) => string };
export function Y(props: Props) {
  return props.t('props.dot.t');
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    expect(catalog.usages.map((u) => u.key)).toContain("props.dot.t");
  });

  it("does not treat { t: string } data props as translators", async () => {
    const root = await fixture({
      "src/Z.tsx": `
export function Z({ t }: { t: string }) {
  return t;
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    expect(catalog.usages).toEqual([]);
  });
});

describe("composed / concatenated keys", () => {
  it('resolves t("HELLO_" + "AGAIN") to HELLO_AGAIN', async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/A.tsx": `
import { useTranslation } from 'react-i18next';
export function A() {
  const { t } = useTranslation();
  return t("HELLO_" + "AGAIN");
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    expect(catalog.usages.map((u) => u.key)).toContain("HELLO_AGAIN");
  });

  it("resolves nested concat and static template holes", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/B.tsx": `
import { useTranslation } from 'react-i18next';
export function B() {
  const { t } = useTranslation();
  return (
    <>
      {t("auth" + "." + "login")}
      {t(\`settings.\${"title"}\`)}
    </>
  );
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const keys = catalog.usages.map((u) => u.key);
    expect(keys).toContain("auth.login");
    expect(keys).toContain("settings.title");
  });

  it("resolves t(KEY) when KEY is a same-file const string", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/C.tsx": `
import { useTranslation } from 'react-i18next';
const KEY = "const.key";
const PREFIX = "hello";
export function C() {
  const { t } = useTranslation();
  return t(KEY) + t(PREFIX + "_world");
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const keys = catalog.usages.map((u) => u.key);
    expect(keys).toContain("const.key");
    expect(keys).toContain("hello_world");
  });

  it("does not invent keys for dynamic suffixes", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/D.tsx": `
import { useTranslation } from 'react-i18next';
export function D(suffix: string) {
  const { t } = useTranslation();
  return t("HELLO_" + suffix);
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    expect(catalog.usages.map((u) => u.key)).not.toContain("HELLO_");
    expect(catalog.usages.every((u) => !u.key.startsWith("HELLO_"))).toBe(true);
    expect(catalog.dynamicUsages.length).toBeGreaterThan(0);
    expect(catalog.dynamicUsages[0]!.prefixes).toContain("HELLO_");
  });

  it("resolves concat keys through prop-passed t", async () => {
    const root = await fixture({
      "src/E.tsx": `
export function E({ t }) {
  return t("HELLO_" + "AGAIN");
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    expect(catalog.usages.map((u) => u.key)).toContain("HELLO_AGAIN");
  });
});
