import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverProject } from "../src/internal/discover.js";
import { toPosixPath, normalizeAbsolute, pathsEqual } from "../src/internal/paths.js";
import { detectTerminalCapabilities } from "../src/internal/supports.js";
import { createProgressRenderer } from "../src/internal/progress.js";
import { resolveScanLimits } from "../src/internal/scan-limits.js";
import { runCheck } from "../src/internal/run-check.js";
import { fixture } from "./helpers.js";

describe("path normalization", () => {
  it("toPosixPath converts Windows separators", () => {
    expect(toPosixPath("src\\locales\\en.json")).toBe("src/locales/en.json");
    expect(toPosixPath("src/locales/en.json")).toBe("src/locales/en.json");
  });

  it("normalizeAbsolute is absolute", () => {
    const p = normalizeAbsolute(".");
    expect(path.isAbsolute(p)).toBe(true);
  });

  it("pathsEqual is case-insensitive on win32 semantics", () => {
    if (process.platform === "win32") {
      expect(pathsEqual("C:\\A", "c:\\a")).toBe(true);
    } else {
      expect(pathsEqual("/A", "/A")).toBe(true);
      expect(pathsEqual("/A", "/a")).toBe(false);
    }
  });
});

describe("Linux / macOS / Windows path discovery", () => {
  it("resolves nested path to package root (POSIX-style join)", () => {
    const root = fixture({
      "package.json": '{"name":"app"}',
      "src/nested/file.ts": "export {}",
    });
    const nested = path.join(root, "src", "nested");
    const found = discoverProject({ pathArg: nested, cwd: root });
    expect(found.root).toBe(root);
    expect(found.walkedUp).toBe(true);
    expect(found.scanDir).toBe("src/nested");
  });

  it("accepts absolute project path", () => {
    const root = fixture({ "package.json": '{"name":"app"}' });
    const found = discoverProject({ pathArg: root });
    expect(found.root).toBe(root);
  });
});

describe("color / Unicode / Windows terminals", () => {
  it("disables color under NO_COLOR", () => {
    const caps = detectTerminalCapabilities({
      env: { NO_COLOR: "1" },
      stdoutIsTTY: true,
      stderrIsTTY: true,
    });
    expect(caps.color).toBe(false);
    expect(caps.hyperlinks).toBe(false);
  });

  it("forces color with FORCE_COLOR", () => {
    const caps = detectTerminalCapabilities({
      env: { FORCE_COLOR: "1" },
      stdoutIsTTY: false,
      stderrIsTTY: false,
    });
    expect(caps.color).toBe(true);
  });

  it("uses ASCII glyphs on legacy Windows", () => {
    const caps = detectTerminalCapabilities({
      platform: "win32",
      env: {},
      stdoutIsTTY: true,
      stderrIsTTY: true,
    });
    expect(caps.unicode).toBe(false);

    const lines: string[] = [];
    const progress = createProgressRenderer({
      enabled: true,
      unicode: false,
      color: false,
      stream: {
        write(chunk: string | Uint8Array) {
          lines.push(
            typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(),
          );
          return true;
        },
      } as NodeJS.WritableStream,
    });
    progress.step("Working…");
    progress.succeed("Done");
    expect(lines.join("")).toContain("* Working...");
    expect(lines.join("")).toContain("+ Done");
    expect(lines.join("")).not.toContain("✓");
  });

  it("enables Unicode + hyperlinks on Windows Terminal", () => {
    const caps = detectTerminalCapabilities({
      platform: "win32",
      env: { WT_SESSION: "1", FORCE_COLOR: "1" },
      stdoutIsTTY: true,
      stderrIsTTY: true,
    });
    expect(caps.unicode).toBe(true);
    expect(caps.hyperlinks).toBe(true);
  });

  it("enables hyperlinks on macOS TTY", () => {
    const caps = detectTerminalCapabilities({
      platform: "darwin",
      env: { FORCE_COLOR: "1" },
      stdoutIsTTY: true,
      stderrIsTTY: true,
    });
    expect(caps.hyperlinks).toBe(true);
  });
});

describe("large project handling", () => {
  it("resolves elevated scan limits from env", () => {
    const limits = resolveScanLimits({
      I18N_UNUSED_MAX_FILES: "12345",
      I18N_UNUSED_MAX_CANDIDATES: "999",
    });
    expect(limits.maxFiles).toBe(12345);
    expect(limits.maxCandidates).toBe(999);
  });

  it("analyzes a project with many locale files", async () => {
    const files: Record<string, string> = {
      "package.json": JSON.stringify({
        name: "big",
        dependencies: { i18next: "23.0.0" },
      }),
      "src/app.ts": `import i18next from 'i18next'; i18next.t('k0', { ns: 'ns0' });`,
    };
    for (let i = 0; i < 40; i += 1) {
      files[`locales/en/ns${i}.json`] = JSON.stringify({
        [`k${i}`]: `v${i}`,
        extra: "x",
      });
    }
    const root = fixture(files);
    const result = await runCheck({ path: root, json: true, noColor: true });
    expect(result.exitCode).toBe(0);
    expect(result.analysis.stats.total).toBeGreaterThan(0);
    expect(result.timings.totalMs).toBeGreaterThan(0);
  }, 60_000);
});

describe("no duplicated analyzer logic", () => {
  it("CLI package source does not implement key matching", async () => {
    const fs = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const srcRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../src",
    );
    const files = fs
      .readdirSync(srcRoot, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".ts"))
      .map((f) => path.join(srcRoot, f));

    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      expect(text).not.toMatch(/function\s+isUnusedKey/);
      expect(text).not.toMatch(/missingKeys\s*=/);
      expect(text).not.toMatch(/from\s+["']@babel\//);
    }
  });
});
