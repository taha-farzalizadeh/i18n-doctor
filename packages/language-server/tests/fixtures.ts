/** Reusable project shapes for language server tests. */

import { json } from "./helpers.js";

export const PKG_REACT_I18NEXT = json({
  name: "demo-app",
  version: "1.0.0",
  dependencies: { i18next: "^23.0.0", "react-i18next": "^14.0.0" },
});

/** `t("auth.login")` plus a key that does not exist. */
export const LOGIN_TSX = `import { useTranslation } from "react-i18next";

export function Login() {
  const { t } = useTranslation();
  return <button title={t("auth.login")}>{t("auth.nonexistent")}</button>;
}
`;

/** Same file with the bad key replaced by a valid one. */
export const LOGIN_TSX_FIXED = LOGIN_TSX.replace(
  't("auth.nonexistent")',
  't("auth.logout")',
);

/**
 * Flat single-file-per-locale project:
 *   locales/en.json → { auth: { login, logout } }
 */
export function flatProject(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    "package.json": PKG_REACT_I18NEXT,
    "locales/en.json": json({ auth: { login: "Login", logout: "Logout" } }),
    "locales/fa.json": json({ auth: { login: "ورود", logout: "خروج" } }),
    "src/Login.tsx": LOGIN_TSX,
    ...overrides,
  };
}

export const HOME_TSX = `import { useTranslation } from "react-i18next";

export function Home() {
  const { t } = useTranslation("home");
  return <button>{t("SAVE")}</button>;
}
`;

export const SETTINGS_TSX = `import { useTranslation } from "react-i18next";

export function Settings() {
  const { t } = useTranslation("settings");
  return <button>{t("SAVE")}</button>;
}
`;

/**
 * Namespaced project where `SAVE` exists in three namespaces.
 * `profile:SAVE` is intentionally unused.
 */
export function namespacedProject(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    "package.json": PKG_REACT_I18NEXT,
    "public/locales/en/home.json": json({ SAVE: "Save" }),
    "public/locales/en/settings.json": json({ SAVE: "Save settings" }),
    "public/locales/en/profile.json": json({ SAVE: "Save profile" }),
    "src/Home.tsx": HOME_TSX,
    "src/Settings.tsx": SETTINGS_TSX,
    ...overrides,
  };
}
