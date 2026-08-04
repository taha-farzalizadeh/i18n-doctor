import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { CliError } from "../src/internal/errors.js";
import {
  assertConfigReadable,
  discoverProject,
} from "../src/internal/discover.js";
import { runCheck } from "../src/internal/run-check.js";
import { fixture, i18nDemo, withCapturedStdio } from "./helpers.js";

describe("invalid path / missing project", () => {
  it("discover throws NOT_FOUND for missing path", () => {
    expect(() =>
      discoverProject({ pathArg: "/no/such/i18n-unused-path-xyz" }),
    ).toThrow(CliError);
    try {
      discoverProject({ pathArg: "/no/such/i18n-unused-path-xyz" });
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe("NOT_FOUND");
      expect((e as CliError).exitCode).toBe(2);
    }
  });

  it("runCheck on missing path exits via CliError", async () => {
    await expect(
      runCheck({ path: "/no/such/i18n-unused-path-xyz", json: true }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", exitCode: 2 });
  });

  it("runCli check missing path returns exit 2", async () => {
    const { result, stderr } = await withCapturedStdio(() =>
      runCli([
        "node",
        "i18n-unused",
        "check",
        "/no/such/i18n-unused-path-xyz",
        "--json",
      ]),
    );
    expect(result).toBe(2);
    expect(stderr).toMatch(/error\[NOT_FOUND\]/);
  });
});

describe("permission errors", () => {
  it("maps EACCES to PERMISSION via injectable fs", () => {
    expect(() =>
      discoverProject({
        pathArg: "/secret",
        cwd: "/",
        fs: {
          existsSync: () => true,
          statSync: () => ({
            isDirectory: () => true,
          }),
          accessSync: () => {
            const err = new Error("denied") as NodeJS.ErrnoException;
            err.code = "EACCES";
            throw err;
          },
        },
      }),
    ).toThrow(CliError);

    try {
      discoverProject({
        pathArg: "/secret",
        cwd: "/",
        fs: {
          existsSync: () => true,
          statSync: () => ({ isDirectory: () => true }),
          accessSync: () => {
            const err = new Error("denied") as NodeJS.ErrnoException;
            err.code = "EACCES";
            throw err;
          },
        },
      });
    } catch (e) {
      expect((e as CliError).code).toBe("PERMISSION");
      expect((e as CliError).exitCode).toBe(2);
    }
  });

  it("chmod-denied directory on POSIX", () => {
    if (process.platform === "win32") return;
    if (typeof process.getuid === "function" && process.getuid() === 0) return;

    const dir = fixture({ "package.json": '{"name":"x"}' });
    fs.chmodSync(dir, 0o000);
    try {
      expect(() => discoverProject({ pathArg: dir })).toThrow(CliError);
    } finally {
      fs.chmodSync(dir, 0o755);
    }
  });
});

describe("invalid config", () => {
  it("missing --config path → NOT_FOUND", () => {
    const root = fixture({ "package.json": '{"name":"app"}' });
    expect(() =>
      assertConfigReadable(path.join(root, "missing.config.json"), root),
    ).toThrow(/Config file not found/);
  });

  it("invalid severity in config → CONFIG exit 2", async () => {
    const root = fixture({
      "package.json": '{"name":"app"}',
      "bad.config.json": JSON.stringify({
        rules: { "unused-key": "not-a-severity" },
      }),
    });
    await expect(
      runCheck({
        path: root,
        config: path.join(root, "bad.config.json"),
        json: true,
      }),
    ).rejects.toMatchObject({ code: "CONFIG", exitCode: 2 });
  });

  it("runCli surfaces CONFIG errors on stderr", async () => {
    const root = fixture({
      "package.json": '{"name":"app"}',
      "bad.config.json": JSON.stringify({
        output: { format: "nope" },
      }),
    });
    const { result, stderr } = await withCapturedStdio(() =>
      runCli([
        "node",
        "i18n-unused",
        "check",
        root,
        "--config",
        path.join(root, "bad.config.json"),
        "--json",
      ]),
    );
    expect(result).toBe(2);
    expect(stderr).toMatch(/error\[CONFIG\]/);
  });
});

describe("empty project", () => {
  it("completes with zero issues and exit 0", async () => {
    const root = fixture({ "package.json": '{"name":"empty"}' });
    const result = await runCheck({ path: root, json: true, noColor: true });
    expect(result.exitCode).toBe(0);
    expect(result.analysis.stats.total).toBe(0);
    expect(result.report).toContain('"total": 0');
  });
});

describe("check formats on real fixture", () => {
  it("json", async () => {
    const root = i18nDemo();
    const result = await runCheck({ path: root, json: true, noColor: true });
    expect(result.format).toBe("json");
    expect(() => JSON.parse(result.report)).not.toThrow();
    expect(result.report).toContain("unused");
    expect(result.exitCode).toBe(0);
  });

  it("sarif", async () => {
    const root = i18nDemo();
    const result = await runCheck({ path: root, sarif: true, noColor: true });
    expect(result.format).toBe("sarif");
    const doc = JSON.parse(result.report) as { version: string };
    expect(doc.version).toBe("2.1.0");
  });

  it("markdown", async () => {
    const root = i18nDemo();
    const result = await runCheck({
      path: root,
      markdown: true,
      noColor: true,
    });
    expect(result.format).toBe("markdown");
    expect(result.report).toContain("# i18n-unused report");
  });

  it("html", async () => {
    const root = i18nDemo();
    const result = await runCheck({ path: root, html: true, noColor: true });
    expect(result.format).toBe("html");
    expect(result.report).toContain("<!DOCTYPE html>");
  });

  it("silent", async () => {
    const root = i18nDemo();
    const result = await runCheck({ path: root, silent: true });
    expect(result.format).toBe("silent");
    expect(result.report).toBe("");
  });
});
