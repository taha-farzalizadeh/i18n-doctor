import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXTENSIONS,
  DEFAULT_SCANNER_CONFIG,
  resolveScannerConfig,
} from "../../src/index.js";

describe("scanner config", () => {
  it("resolves defaults for production scanning", () => {
    const resolved = resolveScannerConfig({});
    expect(resolved.symlink).toBe("within-root");
    expect(resolved.hash).toBe("on-demand");
    expect(resolved.completeness).toBe("strict");
    expect(resolved.ignoreDefaults).toBe(true);
    expect(resolved.useGitIgnore).toBe(true);
    expect(resolved.extensions).toEqual([...DEFAULT_EXTENSIONS]);
    expect(resolved.fsConcurrency).toBe(DEFAULT_SCANNER_CONFIG.fsConcurrency);
  });

  it("overrides selected fields without dropping defaults", () => {
    const resolved = resolveScannerConfig({
      root: "/repo",
      maxFileBytes: 1024,
      symlink: "never",
      extensions: ["ts", "tsx"],
    });
    expect(resolved.root).toBe("/repo");
    expect(resolved.maxFileBytes).toBe(1024);
    expect(resolved.symlink).toBe("never");
    expect(resolved.extensions).toEqual(["ts", "tsx"]);
    expect(resolved.useGitIgnore).toBe(true);
  });
});
