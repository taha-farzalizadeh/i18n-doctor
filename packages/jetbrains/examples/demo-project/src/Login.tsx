import { useTranslation } from "react-i18next";

export function Login() {
  const { t } = useTranslation();
  return (
    <button title={t("auth.login")}>
      {/* Underlined until auth.nonexistent exists in locales/*.json */}
      {t("auth.nonexistent")}
    </button>
  );
}
