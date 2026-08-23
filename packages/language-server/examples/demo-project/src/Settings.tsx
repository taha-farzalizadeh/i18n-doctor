import { useTranslation } from "react-i18next";

export function Settings() {
  // `SAVE` resolves against `settings:SAVE`, never `auth:SAVE`.
  const { t } = useTranslation("settings");

  return (
    <div>
      <button>{t("SAVE")}</button>
      <button>{t("CANCEL")}</button>
    </div>
  );
}
