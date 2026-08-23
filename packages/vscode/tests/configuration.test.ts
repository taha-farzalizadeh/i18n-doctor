import { describe, expect, it } from "vitest";
import {
  packageJsonMentionsI18n,
  readSettings,
  toConfigurationParams,
  toInitializationOptions,
  type ConfigurationReader,
} from "../src/configuration.js";

/** Builds a reader where only `explicit` keys count as user-set. */
function reader(
  explicit: Record<string, unknown>,
  defaults: Record<string, unknown> = {},
): ConfigurationReader {
  return {
    get<T>(section: string): T | undefined {
      if (section in explicit) return explicit[section] as T;
      return defaults[section] as T | undefined;
    },
    inspect<T>(section: string) {
      if (section in explicit) {
        return { globalValue: explicit[section] as T };
      }
      return {};
    },
  };
}

describe("readSettings", () => {
  it("defaults to enabled with no forwarded overrides", () => {
    const settings = readSettings(
      reader(
        {},
        {
          // Defaults exist in the settings UI but must NOT be forwarded,
          // otherwise they would override the project's config file.
          "languageServer.debounce": 250,
          "languageServer.logLevel": "error",
          "languageServer.maxDiagnosticsPerFile": 500,
          "languageServer.coverage": true,
        },
      ),
    );

    expect(settings.enabled).toBe(true);
    expect(settings.serverPath).toBeUndefined();
    expect(settings.languageServer).toEqual({});
  });

  it("forwards only explicitly-set values", () => {
    const settings = readSettings(
      reader(
        { "languageServer.debounce": 100 },
        { "languageServer.logLevel": "error" },
      ),
    );

    expect(settings.languageServer).toEqual({ debounce: 100 });
  });

  it("reads every language server option when set", () => {
    const settings = readSettings(
      reader({
        enabled: false,
        "languageServer.debounce": 50,
        "languageServer.logLevel": "debug",
        "languageServer.maxDiagnosticsPerFile": 10,
        "languageServer.coverage": false,
        "languageServer.path": "  /opt/server.js  ",
      }),
    );

    expect(settings).toEqual({
      enabled: false,
      serverPath: "/opt/server.js",
      languageServer: {
        debounce: 50,
        logLevel: "debug",
        maxDiagnosticsPerFile: 10,
        coverage: false,
      },
    });
  });

  it("treats an empty server path as unset", () => {
    const settings = readSettings(reader({ "languageServer.path": "   " }));
    expect(settings.serverPath).toBeUndefined();
  });

  it("ignores values of the wrong type", () => {
    const settings = readSettings(
      reader({
        "languageServer.debounce": "fast",
        "languageServer.coverage": "yes",
      }),
    );
    expect(settings.languageServer).toEqual({});
  });
});

describe("settings forwarding payloads", () => {
  it("shapes initializationOptions the way the server reads them", () => {
    const options = toInitializationOptions({
      enabled: true,
      serverPath: undefined,
      languageServer: { debounce: 100, logLevel: "warn" },
    });

    expect(options).toEqual({
      languageServer: { debounce: 100, logLevel: "warn" },
    });
  });

  it("maps i18nDoctor.enabled=false into the languageServer block", () => {
    const options = toInitializationOptions({
      enabled: false,
      serverPath: undefined,
      languageServer: {},
    });

    expect(options).toEqual({ languageServer: { enabled: false } });
  });

  it("wraps didChangeConfiguration payloads in a settings envelope", () => {
    const params = toConfigurationParams({
      enabled: true,
      serverPath: undefined,
      languageServer: { debounce: 400 },
    });

    expect(params).toEqual({
      settings: { languageServer: { debounce: 400 } },
    });
  });
});

describe("packageJsonMentionsI18n", () => {
  it("recognizes known i18n dependencies in any section", () => {
    expect(
      packageJsonMentionsI18n({ dependencies: { i18next: "^23.0.0" } }),
    ).toBe(true);
    expect(
      packageJsonMentionsI18n({ devDependencies: { "@lingui/cli": "1" } }),
    ).toBe(true);
    expect(
      packageJsonMentionsI18n({ peerDependencies: { "vue-i18n": "9" } }),
    ).toBe(true);
  });

  it("recognizes an inline i18n-doctor config block", () => {
    expect(packageJsonMentionsI18n({ "i18n-doctor": {} })).toBe(true);
  });

  it("rejects unrelated projects and malformed input", () => {
    expect(
      packageJsonMentionsI18n({ dependencies: { express: "^4.0.0" } }),
    ).toBe(false);
    expect(packageJsonMentionsI18n(null)).toBe(false);
    expect(packageJsonMentionsI18n("not json")).toBe(false);
    expect(packageJsonMentionsI18n({ dependencies: "oops" })).toBe(false);
  });
});
