import { describe, expect, it } from "vitest";
import { runCheck } from "../src/internal/run-check.js";
import { fixture } from "./helpers.js";

/**
 * Patterns fixed in usages must stay green through the CLI (`npx i18n-doctor`).
 */
function intelligenceFixture(): string {
  return fixture({
    "package.json": JSON.stringify({
      name: "intelligence",
      dependencies: { i18next: "23.0.0", "react-i18next": "14.0.0" },
    }),
    "locales/en/usersManagement.json": JSON.stringify({
      USER_NAME: "username",
      NAME: "name",
      LAST_NAME: "last",
      PASSWORD: "pw",
      CONFIRM_PASSWORD: "confirm",
      ORPHAN_USER: "unused in users ns",
    }),
    "locales/en/wp.json": JSON.stringify({
      DATASETS: "Datasets",
      SENSITIVE_TERMS: "Sensitive terms",
      SHOW: "Show",
      ORPHAN_WP: "unused in wp",
    }),
    "locales/en/navigation.json": JSON.stringify({
      CHANGE_PROFILES: "Change Profile",
      DATA_EXPLORE: "Explore",
      ORPHAN_NAV: "unused nav",
    }),
    "src/wpTypes.ts": `
export enum WpNavbar {
  DATASETS = "DATASETS",
  SENSITIVE_TERMS = "SENSITIVE_TERMS",
}
`,
    "src/navigationConfig.ts": `
export const navigationConfig = [
  { id: "CHANGE_PROFILES", translation: "CHANGE_PROFILES" },
  { id: "DATA_EXPLORE", translation: "DATA_EXPLORE" },
];
`,
    "src/NavItem.tsx": `
import { useTranslation } from "react-i18next";
export function NavItem({ item }: { item: { translation?: string } }) {
  const { t } = useTranslation("navigation");
  return <span>{item.translation ? t(item.translation) : null}</span>;
}
`,
    "src/Navbar.tsx": `
import { navigationConfig } from "./navigationConfig";
import { NavItem } from "./NavItem";
export function Navbar() {
  return navigationConfig.map((item) => <NavItem key={item.id} item={item} />);
}
`,
    "src/formUtils.ts": `
export const userFormFields = (isEdit?: boolean) => [
  { id: "username", label: "USER_NAME", disable: !!isEdit },
  { id: "firstName", label: "NAME" },
  { id: "lastName", label: "LAST_NAME" },
  { id: "password", label: "PASSWORD", hide: !!isEdit },
  { id: "confirmPassword", label: "CONFIRM_PASSWORD", hide: !!isEdit },
];
`,
    "src/AddUserForm.tsx": `
import { useTranslation } from "react-i18next";
import { userFormFields } from "./formUtils";
export function AddUserForm(isEdit: boolean) {
  const { t } = useTranslation("usersManagement");
  return userFormFields(isEdit).map((field) => (
    <span key={field.id}>{t(field.label)}</span>
  ));
}
`,
    "src/cols.ts": `
import type { TFunction } from "i18next";
export const usersColumns = (t: TFunction) => [
  { headerName: t("USER_NAME") },
  { headerName: t("NAME") },
  { headerName: t("LAST_NAME") },
];
`,
    "src/UsersTable.tsx": `
import { useTranslation } from "react-i18next";
import { usersColumns } from "./cols";
export function UsersTable() {
  const { t } = useTranslation("usersManagement");
  return usersColumns(t);
}
`,
    "src/ActiveWP.tsx": `
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { WpNavbar } from "./wpTypes";
export function ActiveWP() {
  const { t } = useTranslation("wp");
  const [items, setItems] = useState([
    { name: WpNavbar.DATASETS, value: 0 },
    { name: WpNavbar.SENSITIVE_TERMS, value: 0 },
  ]);
  React.useEffect(() => {
    setItems([
      { name: WpNavbar.DATASETS, value: 1 },
      { name: WpNavbar.SENSITIVE_TERMS, value: 2 },
    ]);
  }, []);
  return (
    <>
      {items.map((item) => (
        <p key={item.name}>{t(item.name)}</p>
      ))}
      <button>{t("SHOW")}</button>
    </>
  );
}
`,
  });
}

describe("CLI intelligence parity", () => {
  it("does not flag form-field, column-factory, or enum-map keys as unused", async () => {
    const root = intelligenceFixture();
    const result = await runCheck({
      path: root,
      json: true,
      noColor: true,
      noCoverage: true,
    });
    const unused = result.analysis.issues
      .filter((i) => i.type === "unused-key")
      .map((i) => i.key);
    const missing = result.analysis.issues
      .filter((i) => i.type === "missing-key")
      .map((i) => i.key);

    for (const key of [
      "USER_NAME",
      "NAME",
      "LAST_NAME",
      "PASSWORD",
      "CONFIRM_PASSWORD",
      "DATASETS",
      "SENSITIVE_TERMS",
      "SHOW",
      "CHANGE_PROFILES",
      "DATA_EXPLORE",
    ]) {
      expect(unused, `unused should not include ${key}`).not.toContain(key);
      expect(missing, `missing should not include ${key}`).not.toContain(key);
    }

    expect(unused).toContain("ORPHAN_USER");
    expect(unused).toContain("ORPHAN_WP");
    expect(unused).toContain("ORPHAN_NAV");
  });

  it("only reports intentional orphan unused keys", async () => {
    const root = intelligenceFixture();
    const result = await runCheck({
      path: root,
      json: true,
      noColor: true,
      noCoverage: true,
    });
    // Orphans are unused-key errors by default — expect those only.
    const unexpected = result.analysis.issues.filter(
      (i) =>
        i.type !== "unused-key" ||
        (i.key !== "ORPHAN_USER" &&
          i.key !== "ORPHAN_WP" &&
          i.key !== "ORPHAN_NAV"),
    );
    expect(unexpected).toEqual([]);
  });
});
