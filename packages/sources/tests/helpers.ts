import { mkdir, writeFile, rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { onTestFinished } from "vitest";

export async function fixture(
  files: Record<string, string>,
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "i18n-sources-"));
  onTestFinished(async () => {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  });
  for (const [relative, content] of Object.entries(files)) {
    const abs = path.join(root, relative);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
  return root;
}
