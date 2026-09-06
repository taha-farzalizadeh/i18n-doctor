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

  it("resolves t(cond ? \"A\" : \"B\") to both static branches", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Ternary.tsx": `
import { useTranslation } from 'react-i18next';
export function Ternary(isMultiSelect: boolean) {
  const { t } = useTranslation();
  return t(isMultiSelect ? "SELECT_DATASET" : "SELECT_DATASET_ITEM");
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const keys = catalog.usages.map((u) => u.key);
    expect(keys).toContain("SELECT_DATASET");
    expect(keys).toContain("SELECT_DATASET_ITEM");
    expect(catalog.dynamicUsages).toEqual([]);
  });

  it("resolves t(fallbackKey) when fallbackKey is a same-file ternary const", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Fallback.tsx": `
import { useTranslation } from 'react-i18next';
export function Fallback(isMultiSelect: boolean, selectedName?: string) {
  const { t } = useTranslation();
  const fallbackKey = isMultiSelect ? "SELECT_DATASET" : "SELECT_DATASET_ITEM";
  return selectedName ?? t(fallbackKey);
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const keys = catalog.usages.map((u) => u.key);
    expect(keys).toContain("SELECT_DATASET");
    expect(keys).toContain("SELECT_DATASET_ITEM");
    expect(catalog.dynamicUsages).toEqual([]);
  });
});

describe("mapped object-array prop keys", () => {
  it("resolves t(field.label) from same-file config array map", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Form.tsx": `
import { useTranslation } from 'react-i18next';
const fields = [
  { id: "username", label: "USER_NAME" },
  { id: "password", label: "PASSWORD" },
  { id: "confirmPassword", label: "CONFIRM_PASSWORD" },
];
export function Form() {
  const { t } = useTranslation();
  return fields.map((field) => t(field.label));
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const keys = catalog.usages.map((u) => u.key);
    expect(keys).toContain("USER_NAME");
    expect(keys).toContain("PASSWORD");
    expect(keys).toContain("CONFIRM_PASSWORD");
  });

  it("resolves t(field.label) from cross-file userFormFields()", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/utils.ts": `
export const userFormFields = (isEdit?: boolean) => [
  { id: "username", label: "USER_NAME", disable: !!isEdit, type: "text" },
  { id: "firstName", label: "NAME", type: "text" },
  { id: "lastName", label: "LAST_NAME", type: "text" },
  { id: "password", label: "PASSWORD", type: "password", hide: !!isEdit },
  { id: "confirmPassword", label: "CONFIRM_PASSWORD", type: "password", hide: !!isEdit },
];
`,
      "src/AddUserForm.tsx": `
import { useTranslation } from 'react-i18next';
import { userFormFields } from './utils';
export function AddUserForm(isEdit: boolean) {
  const { t } = useTranslation('usersManagement');
  return userFormFields(isEdit).map((field) => (
    <span key={field.id}>{t(field.label)}</span>
  ));
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const keys = catalog.usages.map((u) => u.key);
    expect(keys).toContain("USER_NAME");
    expect(keys).toContain("NAME");
    expect(keys).toContain("LAST_NAME");
    expect(keys).toContain("PASSWORD");
    expect(keys).toContain("CONFIRM_PASSWORD");
  });

  it("does not invent keys from unrelated object arrays", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Other.tsx": `
import { useTranslation } from 'react-i18next';
const menu = [{ label: "MENU_HOME" }, { label: "MENU_ABOUT" }];
export function Other(label: string) {
  const { t } = useTranslation();
  return t(label);
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    expect(catalog.usages.map((u) => u.key)).not.toContain("MENU_HOME");
    expect(catalog.usages.map((u) => u.key)).not.toContain("MENU_ABOUT");
  });

  it("resolves t(item.name) from useState + string enum members", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/wpTypes.ts": `
export enum WpNavbar {
  FILES = "FILES",
  ACTIVE_WP = "ACTIVE_WP",
  DATASETS = "DATASETS",
  SENSITIVE_TERMS = "SENSITIVE_TERMS",
}
`,
      "src/utils.ts": `
import { WpNavbar } from './wpTypes';
export const initialTotalActiveWpAction = [
  { name: WpNavbar.DATASETS, value: 0 },
  { name: WpNavbar.SENSITIVE_TERMS, value: 0 },
];
`,
      "src/ActiveWPActions.tsx": `
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WpNavbar } from './wpTypes';
import { initialTotalActiveWpAction } from './utils';

export function ActiveWPActions(uuid: string) {
  const { t } = useTranslation('wp');
  const [totalActiveWpCount, setTotalActiveWpCount] = useState(initialTotalActiveWpAction);

  React.useEffect(() => {
    setTotalActiveWpCount([
      { name: WpNavbar.DATASETS, value: 1 },
      { name: WpNavbar.SENSITIVE_TERMS, value: 2 },
    ]);
  }, [uuid]);

  return (
    <>
      {totalActiveWpCount.map((item) => (
        <p key={item.name}>{t(item.name)}</p>
      ))}
      <span>{t("SHOW")}</span>
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
    expect(keys).toContain("DATASETS");
    expect(keys).toContain("SENSITIVE_TERMS");
    expect(keys).toContain("SHOW");
    const sensitive = catalog.usages.find((u) => u.key === "SENSITIVE_TERMS");
    expect(sensitive?.namespace).toBe("wp");
  });

  it("resolves t(WpNavbar.SENSITIVE_TERMS) from imported string enum", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/wpTypes.ts": `
export enum WpNavbar {
  SENSITIVE_TERMS = "SENSITIVE_TERMS",
}
`,
      "src/Page.tsx": `
import { useTranslation } from 'react-i18next';
import { WpNavbar } from './wpTypes';
export function Page() {
  const { t } = useTranslation('wp');
  return t(WpNavbar.SENSITIVE_TERMS);
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const u = catalog.usages.find((x) => x.key === "SENSITIVE_TERMS");
    expect(u?.namespace).toBe("wp");
  });
});
