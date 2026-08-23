import { useTranslation } from "react-i18next";

export function Login() {
  const { t } = useTranslation("auth");

  return (
    <form>
      <button type="submit">{t("login")}</button>
      {/* `auth:nonexistent` is not defined anywhere → missing-key. */}
      <a href="/reset">{t("nonexistent")}</a>
    </form>
  );
}
