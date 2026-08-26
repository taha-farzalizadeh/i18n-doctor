import { describe, expect, it } from "vitest";
import { createUsageDetector } from "../src/index.js";
import { fixture } from "./helpers.js";

describe("untranslated text", () => {
  it("flags JSX text and user-facing attributes when i18n is present", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Login.tsx": `
import { useTranslation } from 'react-i18next';
export function Login() {
  const { t } = useTranslation();
  return (
    <form>
      <h1>Welcome back</h1>
      <input placeholder="Email address" />
      <button title="Submit form">{t('login.submit')}</button>
    </form>
  );
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const texts = catalog.untranslatedLiterals.map((u) => u.text);
    expect(texts).toContain("Welcome back");
    expect(texts).toContain("Email address");
    expect(texts).toContain("Submit form");
    expect(catalog.usages.map((u) => u.key)).toContain("login.submit");
  });

  it("does not flag text already passed to t()", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Ok.tsx": `
import { useTranslation } from 'react-i18next';
export function Ok() {
  const { t } = useTranslation();
  return <p>{t('greeting')}</p>;
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    expect(catalog.untranslatedLiterals).toEqual([]);
  });

  it("skips files without i18n bindings", async () => {
    const root = await fixture({
      "src/Plain.tsx": `
export function Plain() {
  return <h1>No i18n here</h1>;
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    expect(catalog.untranslatedLiterals).toEqual([]);
  });

  it("skips technical strings and classNames", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Tech.tsx": `
import { useTranslation } from 'react-i18next';
export function Tech() {
  const { t } = useTranslation();
  return (
    <a className="btn-primary" href="/login" src="/logo.png">
      {t('ok')}
    </a>
  );
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    expect(catalog.untranslatedLiterals).toEqual([]);
  });
});
