import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.chmodSync(dir, 0o755);
    } catch {
      // ignore
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

export function fixture(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-cli-"));
  tempDirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, "utf8");
  }
  return dir;
}

export function i18nDemo(extra: Record<string, string> = {}): string {
  return fixture({
    "package.json": JSON.stringify({
      name: "demo",
      dependencies: { i18next: "23.0.0", "react-i18next": "14.0.0" },
    }),
    "public/locales/en/common.json": JSON.stringify({
      hello: "Hello",
      unused: "Gone",
    }),
    "src/App.tsx": `
      import { useTranslation } from 'react-i18next';
      export function App() {
        const { t } = useTranslation('common');
        return <span>{t('hello')}</span>;
      }
    `,
    ...extra,
  });
}

export async function withCapturedStdio<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; stdout: string; stderr: string }> {
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  let stdout = "";
  let stderr = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stderr.write;
  try {
    const result = await fn();
    return { result, stdout, stderr };
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
}
