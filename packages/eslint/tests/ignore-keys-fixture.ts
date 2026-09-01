import type { LintMessage } from "./helpers.js";

const CONFIG_TS = `
import { defineConfig } from "i18n-doctor";

export default defineConfig({
  ignoreKeys: ["SERVER_*", "BACKEND_*"],
});
`;

/** Same fixture shape as packages/cli/tests/config-ignore-keys.test.ts. */
export function ignoreKeysFixture(
  configFile: Record<string, string> = {},
): Record<string, string> {
  return {
    "package.json": JSON.stringify({
      name: "demo",
      private: true,
      dependencies: { i18next: "23.0.0", "react-i18next": "14.0.0" },
    }),
    ...configFile,
    "locales/en/common.json": JSON.stringify({
      title: "Title",
      farewell: "Farewell",
      SERVER_USER_CREATED: "User created",
      SERVER_USER_DELETED: "User deleted",
    }),
    "locales/en/errors.json": JSON.stringify({
      BACKEND_ERROR: "Backend error",
      usedError: "Used error",
    }),
    "i18n/en/common.json": JSON.stringify({ title: "Title duplicate" }),
    "src/App.tsx": `
      import { useTranslation } from 'react-i18next';
      export function App() {
        const { t } = useTranslation('common');
        const { t: tErr } = useTranslation('errors');
        return (
          <div>
            <span>{t('title')}</span>
            <span>{t('hello')}</span>
            <span>{tErr('usedError')}</span>
            <span>{tErr('BACKEND_TIMEOUT')}</span>
            <p>Welcome</p>
          </div>
        );
      }
    `,
  };
}

export function unusedKeyOf(message: LintMessage): string | undefined {
  if (message.ruleId !== "i18n-doctor/no-unused-key") return undefined;
  return /^Translation key "([^"]+)" is unused\./.exec(message.message)?.[1];
}

/** Strips an optional `namespace:` prefix for cross-consumer comparison. */
export function bareKey(displayKey: string): string {
  const colon = displayKey.indexOf(":");
  return colon >= 0 ? displayKey.slice(colon + 1) : displayKey;
}
