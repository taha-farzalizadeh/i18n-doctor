import path from "node:path";
import { describe, expect, it } from "vitest";
import { createUsageDetector } from "../src/index.js";
import { fixture } from "./helpers.js";

describe("React / i18next usages", () => {
  it("detects t(\"key\") from useTranslation", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/A.tsx": `
import { useTranslation } from 'react-i18next';
export function A() {
  const { t } = useTranslation();
  return t('hello');
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const u = catalog.usages.find((x) => x.key === "hello");
    expect(u).toBeDefined();
    expect(u!.relativePath).toBe("src/A.tsx");
    expect(u!.absolutePath).toBe(path.join(root, "src/A.tsx"));
    expect(u!.location.line).toBe(5);
    expect(u!.location.column).toBeGreaterThan(0);
    expect(u!.library).toBe("react-i18next");
    expect(u!.context).toBe("function-call");
    expect(u!.evidence).toContain("i18next-detector");
  });

  it("detects i18n.t(\"key\")", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { i18next: "23.0.0" },
      }),
      "src/boot.ts": `
import i18n from 'i18next';
i18n.t('boot.key');
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const u = catalog.usages.find((x) => x.key === "boot.key");
    expect(u?.context).toBe("member-call");
    expect(u?.library).toBe("i18next");
    expect(u?.location.line).toBe(3);
  });

  it("detects renamed destructuring from useTranslation", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Login.tsx": `
import { useTranslation } from 'react-i18next';
export function Login() {
  const { t: translate } = useTranslation('auth');
  return translate('login');
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const u = catalog.usages.find((x) => x.key === "login");
    expect(u?.namespace).toBe("auth");
    expect(u?.evidence).toContain("t: translate");
    expect(u?.location.line).toBe(5);
  });

  it("supports multiple hooks with different namespaces in nested scopes", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Nested.tsx": `
import { useTranslation } from 'react-i18next';
export function Outer() {
  const { t } = useTranslation('outer');
  function Inner() {
    const { t } = useTranslation('inner');
    return t('inner-key');
  }
  return t('outer-key');
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const inner = catalog.usages.find((x) => x.key === "inner-key");
    const outer = catalog.usages.find((x) => x.key === "outer-key");
    expect(inner?.namespace).toBe("inner");
    expect(outer?.namespace).toBe("outer");
  });
});
