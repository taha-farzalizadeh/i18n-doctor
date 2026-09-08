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

  it("resolves t(item.translation) when item is a props binding (nav config)", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/navigationConfig.tsx": `
import React from 'react';
const Icon = () => <span />;
const navigationConfig = [
  { id: "divider", translation: "", type: "divider" },
  {
    id: "CHANGE_PROFILES",
    translation: "CHANGE_PROFILES",
    type: "component",
    icon: <Icon />,
  },
  {
    id: "DATA_EXPLORE",
    translation: "DATA_EXPLORE",
    type: "item",
    children: [
      { id: "ACTIVE_WP", translation: "ACTIVE_WP", type: "item" },
    ],
  },
];
export default navigationConfig;
`,
      "src/NavItem.tsx": `
import { useTranslation } from 'react-i18next';
type Item = { translation?: string };
export function NavItem({ item }: { item: Item }) {
  const { t } = useTranslation('navigation');
  return <span>{item.translation ? t(item.translation) : null}</span>;
}
`,
      "src/Navbar.tsx": `
import navigation from './navigationConfig';
import { NavItem } from './NavItem';
export function Navbar() {
  return navigation.map((item) => <NavItem key={item.id} item={item} />);
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const keys = catalog.usages.map((u) => u.key);
    expect(keys).toContain("CHANGE_PROFILES");
    expect(keys).toContain("DATA_EXPLORE");
    expect(keys).toContain("ACTIVE_WP");
    expect(keys).not.toContain("");
    const change = catalog.usages.find((u) => u.key === "CHANGE_PROFILES");
    expect(change?.namespace).toBe("navigation");
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

  it("resolves t(getTitleByStatusType(v)) from cross-file helper returns", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/utils.tsx": `
export const getTitleByStatusType = (type: string): string => {
  switch (type) {
    case "loading":
      return "THE_PAGE_IS_PROCESSING_INFORMATION";
    case "error":
      return "THE_OPERATION_ENCOUNTERED_AN_ERROR";
    case "empty":
      return "NO_DATA_FOUND_IN_SEARCH_RESULT";
    default:
      return "";
  }
};
`,
      "src/ShowStatus.tsx": `
import { useTranslation } from 'react-i18next';
import { getTitleByStatusType } from './utils';
export function ShowStatus({ variant }: { variant: string }) {
  const { t } = useTranslation('status-renderer');
  return <p>{t(getTitleByStatusType(variant))}</p>;
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const keys = catalog.usages.map((u) => u.key);
    expect(keys).toContain("THE_PAGE_IS_PROCESSING_INFORMATION");
    expect(keys).toContain("THE_OPERATION_ENCOUNTERED_AN_ERROR");
    expect(keys).toContain("NO_DATA_FOUND_IN_SEARCH_RESULT");
  });

  it("resolves t(descriptions[item]) from local string map", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/AddLayer.tsx": `
import { useTranslation } from 'react-i18next';
enum Layer {
  POINT = "POINT",
  HEAT = "HEAT",
}
const descriptions = {
  [Layer.POINT]: "POINT_LAYER_DESCRIPTION",
  [Layer.HEAT]: "HEAT_LAYER_DESCRIPTION",
};
export function AddLayer() {
  const { t } = useTranslation('mapComponent');
  return Object.keys(Layer).map((item) => (
    <p key={item}>{t(descriptions[item as Layer])}</p>
  ));
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const keys = catalog.usages.map((u) => u.key);
    expect(keys).toContain("POINT_LAYER_DESCRIPTION");
    expect(keys).toContain("HEAT_LAYER_DESCRIPTION");
  });

  it("resolves t(config.title) from object-of-objects chartConfigs", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/chartConfigs.ts": `
const configs = {
  geo: { title: "GEO", sampleUri: "a.webp" },
  bar: { title: "BAR", sampleUri: "b.webp" },
  pie: { title: "SHARE_DATASET_PIE_LINE", sampleUri: "c.webp" },
};
export default configs;
`,
      "src/ChartListItem.tsx": `
import { useTranslation } from 'react-i18next';
type ChartConfig = { title: string };
export function ChartListItem({ config }: { config: ChartConfig }) {
  const { t } = useTranslation('AGGREGATION');
  return <p>{t(config.title)}</p>;
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const keys = catalog.usages.map((u) => u.key);
    expect(keys).toContain("GEO");
    expect(keys).toContain("BAR");
    expect(keys).toContain("SHARE_DATASET_PIE_LINE");
  });

  it("resolves t(matchedTitle) from getRouteParam(..., 'title')", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/userManagementRoute.tsx": `
export default {
  path: "users",
  title: "USERS_MANAGEMENT",
};
`,
      "src/regionRoute.tsx": `
export default {
  path: "regions",
  title: "REGION_MANAGEMENT",
};
`,
      "src/utils.ts": `
export function getRouteParam(pathname: string, key: string) {
  return key;
}
`,
      "src/AppLayout.tsx": `
import { useTranslation } from 'react-i18next';
import { getRouteParam } from './utils';
export function AppLayout({ pathname }: { pathname: string }) {
  const { t } = useTranslation('routes');
  const matchedTitle = getRouteParam(pathname, "title");
  return <title>{t(matchedTitle)}</title>;
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const keys = catalog.usages.map((u) => u.key);
    expect(keys).toContain("USERS_MANAGEMENT");
    expect(keys).toContain("REGION_MANAGEMENT");
  });

  it("resolves Object.keys(Enum).map((key) => t(key))", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/types.ts": `
export enum DateTimeFilterValue {
  TODAY = "TODAY",
  YESTERDAY = "YESTERDAY",
  PREVIOUS_MONTH = "PREVIOUS_MONTH",
}
`,
      "src/DateInput.tsx": `
import { useTranslation } from 'react-i18next';
import { DateTimeFilterValue } from './types';
export function DateInput() {
  const { t } = useTranslation('general');
  return Object.keys(DateTimeFilterValue).map((key) => (
    <span key={key}>{t(key)}</span>
  ));
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const keys = catalog.usages.map((u) => u.key);
    expect(keys).toContain("TODAY");
    expect(keys).toContain("YESTERDAY");
    expect(keys).toContain("PREVIOUS_MONTH");
  });

  it("resolves t(sortOption.name) from local options array", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Footer.tsx": `
import { useTranslation } from 'react-i18next';
export function Footer() {
  const { t } = useTranslation('aggregation');
  const sortOptions = [
    { value: "ASC", name: "ASCENDING" },
    { value: "DESC", name: "DESCENDING" },
  ];
  return sortOptions.map((sortOption) => (
    <span key={sortOption.value}>{t(sortOption.name)}</span>
  ));
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const keys = catalog.usages.map((u) => u.key);
    expect(keys).toContain("ASCENDING");
    expect(keys).toContain("DESCENDING");
  });

  it("does not pull every indexed type string for t(newValue.type)", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0", i18next: "23.0.0" },
      }),
      "src/menu.ts": `
export const menu = [
  { type: "Access" },
  { type: "CSV" },
  { type: "MySQL" },
];
`,
      "src/utils.ts": `
import type { TFunction } from 'i18next';
export function createNewLayer(t: TFunction, newValue: { type: string }) {
  return t(newValue.type);
}
`,
      "src/Page.tsx": `
import { useTranslation } from 'react-i18next';
import { createNewLayer } from './utils';
export function Page() {
  const { t } = useTranslation('mapComponent');
  return createNewLayer(t, { type: "POINT" });
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const keys = catalog.usages.map((u) => u.key);
    expect(keys).not.toContain("Access");
    expect(keys).not.toContain("CSV");
    expect(keys).not.toContain("MySQL");
  });

  it("resolves (['JALALI','GEORGIAN'] as const).map((op) => t(op))", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Filter.tsx": `
import { useTranslation } from 'react-i18next';
export function Filter() {
  const { t } = useTranslation('datasets');
  return (["JALALI", "GEORGIAN"] as const).map((operator) => (
    <span key={operator}>{t(operator)}</span>
  ));
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const keys = catalog.usages.map((u) => u.key);
    expect(keys).toContain("JALALI");
    expect(keys).toContain("GEORGIAN");
  });

  it("resolves t(type as string) from enum-typed props", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/types.ts": `
export enum COMPARATIVE_TYPE {
  STRING = "STRING",
  ANY_GEO_SHAPE = "ANY_GEO_SHAPE",
  GEO_POINT = "GEO_POINT",
}
`,
      "src/SingleLevel.tsx": `
import { useTranslation } from 'react-i18next';
import { COMPARATIVE_TYPE } from './types';
type Props = { type?: COMPARATIVE_TYPE | string };
export function SingleLevel(props: Props) {
  const { type } = props;
  const { t } = useTranslation('conditions');
  return <span>{type ? t(type as string) : null}</span>;
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const keys = catalog.usages.map((u) => u.key);
    expect(keys).toContain("STRING");
    expect(keys).toContain("ANY_GEO_SHAPE");
    expect(keys).toContain("GEO_POINT");
    // Enum | string → include legacy ANY_GEO_POINT sibling of ANY_GEO_SHAPE
    expect(keys).toContain("ANY_GEO_POINT");
  });

  it("resolves t(step.labelKey) via indexed progress config", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/utils.ts": `
export const uploadProgressConfig = {
  steps: [
    { key: "processing", labelKey: "PROCESSING" },
    { key: "finalization", labelKey: "FINALIZATION" },
  ],
  statuses: {
    DONE: { stepKey: "finalization", variant: "success" },
  },
};
`,
      "src/Progress.tsx": `
import { useTranslation } from 'react-i18next';
export function Progress({ config }: { config: { steps: { labelKey: string }[] } }) {
  const { t } = useTranslation('upload-list');
  return config.steps.map((step) => <p key={step.labelKey}>{t(step.labelKey)}</p>);
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const keys = catalog.usages.map((u) => u.key);
    expect(keys).toContain("PROCESSING");
    expect(keys).toContain("FINALIZATION");
  });

  it("resolves t(currentStatus.text) from local config lookup", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/utils.ts": `
export const historyStatusColConf = {
  NONE: { text: "NO_STATUS", color: "grey" },
  PROCESSING: { text: "PROCESSING", color: "blue" },
};
`,
      "src/Table.tsx": `
import { useTranslation } from 'react-i18next';
import { historyStatusColConf } from './utils';
export function Table({ status }: { status?: string }) {
  const { t } = useTranslation('etl');
  const currentStatus =
    status && status in historyStatusColConf
      ? historyStatusColConf[status as keyof typeof historyStatusColConf]
      : historyStatusColConf.NONE;
  return <p>{t(currentStatus.text)}</p>;
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const keys = catalog.usages.map((u) => u.key);
    expect(keys).toContain("NO_STATUS");
    expect(keys).toContain("PROCESSING");
  });
});
