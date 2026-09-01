import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import i18nDoctor, { resetAnalysisSessions } from "../src/index.js";
import { ensureWorkerBuilt } from "../src/internal/analysis-session.js";

export function jsonString(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Creates a temp project from relative path → contents. */
export function writeFixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-eslint-"));
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, "utf8");
  }
  return root;
}

export interface LintMessage {
  readonly ruleId: string | null;
  readonly message: string;
  readonly line: number;
  readonly column: number;
  readonly severity: number;
  readonly filePath: string;
}

export function createProjectEslint(cwd: string): ESLint {
  resetAnalysisSessions();
  ensureWorkerBuilt();
  return new ESLint({
    cwd,
    overrideConfigFile: true,
    baseConfig: [
      ...i18nDoctor.configs.recommended,
      {
        files: ["**/*.{js,jsx,ts,tsx}"],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: {
            ecmaFeatures: { jsx: true },
          },
        },
      },
    ],
  });
}

export async function lintProject(
  root: string,
  patterns: string[] = [
    "src/**/*.{js,jsx,ts,tsx}",
    "locales/**/*.json",
    "i18n/**/*.json",
  ],
): Promise<LintMessage[]> {
  const eslint = createProjectEslint(root);
  const results = await eslint.lintFiles(patterns);
  const messages: LintMessage[] = [];
  for (const result of results) {
    for (const message of result.messages) {
      messages.push({
        ruleId: message.ruleId,
        message: message.message,
        line: message.line,
        column: message.column,
        severity: message.severity,
        filePath: result.filePath,
      });
    }
  }
  return messages;
}

export function messagesForFile(
  messages: readonly LintMessage[],
  relativePath: string,
): readonly LintMessage[] {
  return messages.filter((message) =>
    message.filePath.replace(/\\/g, "/").endsWith(relativePath.replace(/\\/g, "/")),
  );
}

export const DEMO_FIXTURE: Record<string, string> = {
  "package.json": jsonString({
    name: "i18n-eslint-demo",
    private: true,
    dependencies: {
      i18next: "^23.0.0",
      "react-i18next": "^14.0.0",
    },
  }),
  "i18n-doctor.config.json": jsonString({
    localesDir: "locales",
    baseLocale: "en",
    rules: {
      "missing-key": "error",
      "unused-key": "warn",
      "duplicate-key": "error",
      "untranslated-text": "warn",
    },
  }),
  "locales/en/auth.json": `{
  "login": "Log in",
  "logout": "Log out",
  "old": "Old action",
  "welcome": "Welcome"
}
`,
  "locales/fa/auth.json": jsonString({
    login: "ورود",
    logout: "خروج",
  }),
  "locales/en/common.json": jsonString({
    save: "Save",
  }),
  "i18n/en/common.json": jsonString({
    save: "Save duplicate",
  }),
  "locales/en/settings.json": jsonString({
    title: "Settings",
  }),
  "locales/fa/settings.json": jsonString({
    headline: "تنظیمات",
  }),
  "src/Login.tsx": `import { useTranslation } from "react-i18next";

type Props = { suffix: string };

export function Login({ suffix }: Props) {
  const { t } = useTranslation("auth");
  return (
    <form>
      <button type="submit">{t("login")}</button>
      <a href="/signin">{t("signin")}</a>
      <p>Welcome back</p>
      <span>{t("HELLO_" + suffix)}</span>
    </form>
  );
}
`,
  "src/Settings.tsx": `import { useTranslation } from "react-i18next";

export function Settings() {
  const { t } = useTranslation("settings");
  return <h1>{t("title")}</h1>;
}
`,
};
