import { afterEach, describe, expect, it } from "vitest";
import {
  lintProject,
  messagesForFile,
  writeFixture,
} from "./helpers.js";
import { resetAnalysisSessions } from "../src/index.js";

afterEach(() => {
  resetAnalysisSessions();
});

function intelligenceFixture(): string {
  return writeFixture({
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
      ORPHAN_USER: "unused",
    }),
    "locales/en/wp.json": JSON.stringify({
      DATASETS: "Datasets",
      SENSITIVE_TERMS: "Sensitive terms",
      SHOW: "Show",
      ORPHAN_WP: "unused",
    }),
    "locales/en/navigation.json": JSON.stringify({
      CHANGE_PROFILES: "Change Profile",
      DATA_EXPLORE: "Explore",
      ORPHAN_NAV: "unused",
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
  { id: "username", label: "USER_NAME" },
  { id: "firstName", label: "NAME" },
  { id: "lastName", label: "LAST_NAME" },
  { id: "password", label: "PASSWORD" },
  { id: "confirmPassword", label: "CONFIRM_PASSWORD" },
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

describe("ESLint intelligence parity", () => {
  it("does not report used form/column/enum keys as unused or missing", async () => {
    const root = intelligenceFixture();
    const messages = await lintProject(root, [
      "src/**/*.{js,jsx,ts,tsx}",
      "locales/**/*.json",
    ]);
    const i18n = messages.filter((m) => m.ruleId?.startsWith("i18n-doctor/"));

    const unusedMsgs = i18n.filter(
      (m) => m.ruleId === "i18n-doctor/no-unused-key",
    );
    const missingMsgs = i18n.filter(
      (m) => m.ruleId === "i18n-doctor/no-missing-key",
    );

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
      expect(
        unusedMsgs.some((m) => m.message.includes(`"${key}"`)),
        `unused for ${key}: ${unusedMsgs.map((m) => m.message).join("; ")}`,
      ).toBe(false);
      expect(
        missingMsgs.some((m) => m.message.includes(`"${key}"`)),
        `missing for ${key}: ${missingMsgs.map((m) => m.message).join("; ")}`,
      ).toBe(false);
    }

    const usersLocale = messagesForFile(
      unusedMsgs,
      "locales/en/usersManagement.json",
    );
    const wpLocale = messagesForFile(unusedMsgs, "locales/en/wp.json");
    const navLocale = messagesForFile(unusedMsgs, "locales/en/navigation.json");
    expect(usersLocale.some((m) => m.message.includes("ORPHAN_USER"))).toBe(
      true,
    );
    expect(wpLocale.some((m) => m.message.includes("ORPHAN_WP"))).toBe(true);
    expect(navLocale.some((m) => m.message.includes("ORPHAN_NAV"))).toBe(true);
  });
});
