import { describe, expect, it } from "vitest";
import { createProgram, runCli } from "../src/cli.js";
import { getPackageVersion } from "../src/internal/version.js";
import { withCapturedStdio } from "./helpers.js";

describe("help", () => {
  it("exposes check command and exit-code help", () => {
    const program = createProgram();
    expect(program.name()).toBe("i18n-unused");
    expect(program.commands.map((c) => c.name())).toContain("check");
    const help = program.helpInformation();
    expect(help).toMatch(/check/);
  });

  it("runCli --help exits 0 and prints usage", async () => {
    const { result, stdout } = await withCapturedStdio(() =>
      runCli(["node", "i18n-unused", "--help"]),
    );
    expect(result).toBe(0);
    expect(stdout).toMatch(/Usage:/);
    expect(stdout).toMatch(/Exit codes:/);
  });

  it("runCli check --help exits 0", async () => {
    const { result, stdout } = await withCapturedStdio(() =>
      runCli(["node", "i18n-unused", "check", "--help"]),
    );
    expect(result).toBe(0);
    expect(stdout).toMatch(/--json/);
    expect(stdout).toMatch(/--sarif/);
    expect(stdout).toMatch(/--markdown/);
    expect(stdout).toMatch(/--namespace/);
    expect(stdout).toMatch(/--ignore-duplicates/);
  });
});

describe("version", () => {
  it("reads semver from package.json", () => {
    expect(getPackageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("runCli --version exits 0", async () => {
    const { result, stdout } = await withCapturedStdio(() =>
      runCli(["node", "i18n-unused", "--version"]),
    );
    expect(result).toBe(0);
    expect(stdout.trim()).toBe(getPackageVersion());
  });

  it("runCli -V exits 0", async () => {
    const { result } = await withCapturedStdio(() =>
      runCli(["node", "i18n-unused", "-V"]),
    );
    expect(result).toBe(0);
  });
});
