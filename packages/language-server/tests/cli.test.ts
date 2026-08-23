import { describe, expect, it } from "vitest";
import { HELP_TEXT, parseCliOptions } from "../src/cli-options.js";
import { SERVER_NAME, SERVER_VERSION } from "../src/index.js";

describe("cli arguments", () => {
  it("serves over stdio by default", () => {
    expect(parseCliOptions([])).toEqual({ action: "serve", unknown: [] });
    expect(parseCliOptions(["--stdio"])).toEqual({
      action: "serve",
      unknown: [],
    });
  });

  it("recognizes help and version", () => {
    for (const arg of ["--help", "-h"]) {
      expect(parseCliOptions([arg]).action).toBe("help");
    }
    for (const arg of ["--version", "-v"]) {
      expect(parseCliOptions([arg]).action).toBe("version");
    }
  });

  it("reads a log level in both spellings", () => {
    expect(parseCliOptions(["--log-level", "debug"]).logLevel).toBe("debug");
    expect(parseCliOptions(["--log-level=warn"]).logLevel).toBe("warn");
  });

  it("ignores an unsupported log level", () => {
    expect(parseCliOptions(["--log-level", "loud"]).logLevel).toBeUndefined();
    expect(parseCliOptions(["--log-level"]).logLevel).toBeUndefined();
  });

  it("reads a debounce value", () => {
    expect(parseCliOptions(["--debounce", "250"]).debounce).toBe(250);
    expect(parseCliOptions(["--debounce=0"]).debounce).toBe(0);
    expect(parseCliOptions(["--debounce", "249.6"]).debounce).toBe(250);
  });

  it("ignores an unusable debounce value", () => {
    expect(parseCliOptions(["--debounce", "soon"]).debounce).toBeUndefined();
    expect(parseCliOptions(["--debounce", "-5"]).debounce).toBeUndefined();
    expect(parseCliOptions(["--debounce"]).debounce).toBeUndefined();
  });

  it("collects unknown arguments without failing", () => {
    const options = parseCliOptions([
      "--stdio",
      "--log-level",
      "info",
      "--clientProcessId=42",
      "extra",
    ]);
    expect(options.action).toBe("serve");
    expect(options.logLevel).toBe("info");
    expect(options.unknown).toEqual(["--clientProcessId=42", "extra"]);
  });

  it("documents every supported option in the help text", () => {
    for (const flag of [
      "--stdio",
      "--log-level",
      "--debounce",
      "--version",
      "--help",
    ]) {
      expect(HELP_TEXT).toContain(flag);
    }
    expect(HELP_TEXT).toContain("silent | error | warn | info | debug");
  });

  it("exposes the identity the server reports over LSP", () => {
    expect(SERVER_NAME).toBe("i18n-doctor-language-server");
    expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
