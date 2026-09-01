import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverProject } from "../src/internal/discover.js";
import {
  filterIssuesByScanDir,
  isUnderScanDir,
} from "../src/internal/filter.js";
import { runCheck } from "../src/internal/run-check.js";
import { fixture } from "./helpers.js";

describe("discoverProject — scanDir", () => {
  it("sets scanDir when the path argument is a subdirectory", () => {
    const root = fixture({
      "package.json": '{"name":"app"}',
      "src/auth/Login.tsx": "export {}",
      "src/other/App.tsx": "export {}",
    });
    const found = discoverProject({
      pathArg: path.join(root, "src", "auth"),
      cwd: root,
    });
    expect(found.root).toBe(root);
    expect(found.scanDir).toBe("src/auth");
  });

  it("omits scanDir for the project root", () => {
    const root = fixture({ "package.json": '{"name":"app"}' });
    const found = discoverProject({ pathArg: root, cwd: root });
    expect(found.scanDir).toBeUndefined();
  });
});

describe("isUnderScanDir", () => {
  it("matches exact and nested paths", () => {
    expect(isUnderScanDir("src/auth", "src/auth")).toBe(true);
    expect(isUnderScanDir("src/auth/Login.tsx", "src/auth")).toBe(true);
    expect(isUnderScanDir("src/other/App.tsx", "src/auth")).toBe(false);
  });
});

describe("runCheck — directory scope", () => {
  it("reports missing keys only for files under the requested folder", async () => {
    const root = fixture({
      "package.json": JSON.stringify({
        name: "scoped",
        dependencies: { i18next: "23.0.0", "react-i18next": "14.0.0" },
      }),
      "locales/en/common.json": JSON.stringify({ ok: "OK" }),
      "src/auth/Login.tsx": `import { useTranslation } from "react-i18next";
export function Login() {
  const { t } = useTranslation("common");
  return t("missing-in-auth");
}
`,
      "src/other/App.tsx": `import { useTranslation } from "react-i18next";
export function App() {
  const { t } = useTranslation("common");
  return t("missing-in-other");
}
`,
    });

    const scoped = await runCheck({
      path: path.join(root, "src", "auth"),
      json: true,
      noColor: true,
      noCoverage: true,
    });
    const paths = scoped.analysis.issues.map((i) => i.location.relativePath);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => isUnderScanDir(p, "src/auth"))).toBe(true);
    expect(
      scoped.analysis.issues.some((i) => i.message.includes("missing-in-auth")),
    ).toBe(true);
    expect(
      scoped.analysis.issues.some((i) => i.message.includes("missing-in-other")),
    ).toBe(false);
  });

  it("supports --dir from the project root", async () => {
    const root = fixture({
      "package.json": JSON.stringify({
        name: "scoped-dir-flag",
        dependencies: { i18next: "23.0.0" },
      }),
      "locales/en.json": JSON.stringify({}),
      "src/only/here.ts": `import i18next from "i18next"; export const x = i18next.t("only-here");`,
      "src/elsewhere/there.ts": `import i18next from "i18next"; export const x = i18next.t("not-here");`,
    });

    const result = await runCheck({
      path: root,
      dir: "src/only",
      json: true,
      noColor: true,
      noCoverage: true,
    });
    expect(
      result.analysis.issues.every((i) =>
        isUnderScanDir(i.location.relativePath, "src/only"),
      ),
    ).toBe(true);
  });
});

describe("filterIssuesByScanDir", () => {
  it("keeps duplicate-key findings on related locations inside the scope", () => {
    const issues = filterIssuesByScanDir(
      [
        {
          type: "duplicate-key",
          severity: "error",
          message: "dup",
          key: "save",
          location: {
            absolutePath: "/proj/i18n/en/common.json",
            relativePath: "i18n/en/common.json",
            line: 1,
            column: 1,
          },
          relatedLocations: [
            {
              absolutePath: "/proj/src/common/save.ts",
              relativePath: "src/common/save.ts",
              line: 1,
              column: 1,
            },
          ],
          source: { kind: "definition-collision" },
        },
      ],
      "src/common",
    );
    expect(issues).toHaveLength(1);
  });
});
