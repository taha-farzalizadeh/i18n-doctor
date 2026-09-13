import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSourceDetector,
  refreshResourceFilesInCatalog,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "i18n-src-refresh-"));
  roots.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content, "utf8");
  }
  return root;
}

describe("refreshResourceFilesInCatalog", () => {
  it("drops a deleted unused key and remaps remaining key locations", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { i18next: "23.0.0" },
      }),
      "locales/en.json": JSON.stringify(
        { auth: { login: "Login", logout: "Log out", orphan: "Gone soon" } },
        null,
        2,
      ),
      "src/App.tsx": `import { t } from "i18next";\nexport const App = () => t("auth.login");\n`,
    });

    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });
    expect(catalog.keys.map((k) => k.key).sort()).toEqual([
      "auth.login",
      "auth.logout",
      "auth.orphan",
    ]);

    const enPath = path.join(root, "locales/en.json");
    const nextText = JSON.stringify(
      { auth: { login: "Login", logout: "Log out" } },
      null,
      2,
    );
    await writeFile(enPath, nextText, "utf8");

    const refreshed = refreshResourceFilesInCatalog({
      catalog,
      absolutePaths: [enPath],
      readFile: (absolute) =>
        absolute === enPath ? nextText : undefined,
    });

    expect(refreshed).toBeDefined();
    expect(refreshed!.keys.map((k) => k.key).sort()).toEqual([
      "auth.login",
      "auth.logout",
    ]);

    const logout = refreshed!.keys.find((k) => k.key === "auth.logout");
    expect(logout).toBeDefined();
    const slice = nextText.slice(logout!.location.start!, logout!.location.end!);
    expect(slice).toContain("logout");
    expect(slice).not.toContain("Log out");
  });

  it("matches macOS /var vs /private/var catalog paths", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({ dependencies: { i18next: "23.0.0" } }),
      "locales/en.json": JSON.stringify({ a: "A", b: "B" }, null, 2),
    });
    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });
    const enPath = path.join(root, "locales/en.json");
    const aliased = enPath.includes("/private/")
      ? enPath.replace("/private/", "/")
      : enPath.replace(/^\/var\//, "/private/var/");
    expect(aliased).not.toBe(enPath);

    const nextText = JSON.stringify({ a: "A" }, null, 2);
    const refreshed = refreshResourceFilesInCatalog({
      catalog,
      absolutePaths: [aliased],
      readFile: (absolute) =>
        absolute === aliased || absolute === enPath ? nextText : undefined,
    });
    expect(refreshed).toBeDefined();
    expect(refreshed!.keys.map((k) => k.key)).toEqual(["a"]);
  });

  it("returns undefined for brand-new locale files (needs full discover)", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({ dependencies: { i18next: "23.0.0" } }),
      "locales/en.json": JSON.stringify({ a: "A" }),
    });
    const catalog = await createSourceDetector().discover({
      root,
      useDetection: false,
    });
    const faPath = path.join(root, "locales/fa.json");
    const result = refreshResourceFilesInCatalog({
      catalog,
      absolutePaths: [faPath],
      readFile: () => JSON.stringify({ a: "آ" }),
    });
    expect(result).toBeUndefined();
  });
});
