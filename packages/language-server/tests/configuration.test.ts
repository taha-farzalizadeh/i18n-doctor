import { describe, expect, it } from "vitest";
import { DEFAULT_LANGUAGE_SERVER, validateUserConfig } from "@i18n-doctor/config";
import { flatProject, LOGIN_TSX } from "./fixtures.js";
import { fixture, harness, json } from "./helpers.js";
import { readLanguageServerSettings } from "../src/server.js";
import { createLogger } from "../src/logger.js";

describe("config file integration", () => {
  it("reads languageServer options from i18n-doctor.config.json", async () => {
    const root = await fixture(
      flatProject({
        "i18n-doctor.config.json": json({
          languageServer: { debounce: 275, logLevel: "debug", coverage: false },
        }),
      }),
    );
    const h = harness(root, { respectConfig: true });
    await h.start();

    const settings = h.core.settings();
    expect(settings?.debounce).toBe(275);
    expect(settings?.logLevel).toBe("debug");
    expect(settings?.coverage).toBe(false);
  });

  it("falls back to defaults when no languageServer block exists", async () => {
    const root = await fixture(flatProject());
    const h = harness(root, { respectConfig: true });
    await h.start();

    expect(h.core.settings()).toEqual(DEFAULT_LANGUAGE_SERVER);
    expect(DEFAULT_LANGUAGE_SERVER.debounce).toBeGreaterThanOrEqual(200);
    expect(DEFAULT_LANGUAGE_SERVER.debounce).toBeLessThanOrEqual(300);
  });

  it("lets an explicit programmatic override win over the config file", async () => {
    const root = await fixture(
      flatProject({
        "i18n-doctor.config.json": json({
          languageServer: { debounce: 400 },
        }),
      }),
    );
    const h = harness(root, { debounce: 0 });
    await h.start();

    expect(h.core.settings()?.debounce).toBe(0);
  });

  it("disables analysis entirely when configured off", async () => {
    const root = await fixture(
      flatProject({
        "i18n-doctor.config.json": json({ languageServer: { enabled: false } }),
      }),
    );
    const h = harness(root);
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);

    expect(h.snapshot()).toEqual({});
  });

  it("stops publishing coverage findings when coverage is off", async () => {
    const files = flatProject({
      "locales/fa.json": json({ auth: { login: "ورود" } }),
      "src/Login.tsx": `import { t } from "i18next";
export const L = () => [t("auth.login"), t("auth.logout")];
`,
    });
    const withCoverage = harness(await fixture(files));
    await withCoverage.start();
    expect(withCoverage.codesFor("locales/en.json")).toContain(
      "missing-translation",
    );

    const withoutCoverage = harness(
      await fixture({
        ...files,
        "i18n-doctor.config.json": json({
          languageServer: { coverage: false },
        }),
      }),
    );
    await withoutCoverage.start();
    expect(withoutCoverage.codesFor("locales/en.json")).not.toContain(
      "missing-translation",
    );
  });

  it("honours rule severities from the shared config", async () => {
    const root = await fixture(
      flatProject({
        "i18n-doctor.config.json": json({
          rules: { "missing-key": "warning" },
        }),
      }),
    );
    const h = harness(root);
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);

    // 2 === DiagnosticSeverity.Warning
    expect(h.diagnosticsFor("src/Login.tsx")[0]?.severity).toBe(2);
  });

  it("honours a rule turned off in the shared config", async () => {
    const root = await fixture(
      flatProject({
        "i18n-doctor.config.json": json({ rules: { "unused-key": "off" } }),
      }),
    );
    const h = harness(root);
    await h.start();

    expect(h.codesFor("locales/en.json")).not.toContain("unused-key");
  });

  it("honours ignore patterns from the shared config", async () => {
    const root = await fixture(
      flatProject({
        "i18n-doctor.config.json": json({ ignoreFiles: ["src/**"] }),
      }),
    );
    const h = harness(root);
    await h.start();

    // With the source tree ignored, every key looks unused and no usage is seen.
    expect(h.diagnosticsFor("src/Login.tsx")).toEqual([]);
    expect(h.codesFor("locales/en.json")).toEqual(["unused-key", "unused-key"]);
  });

  it("reloads config when the config file changes on disk", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();
    expect(h.codesFor("locales/en.json")).toContain("unused-key");

    await import("node:fs/promises").then((fs) =>
      fs.writeFile(
        `${root}/i18n-doctor.config.json`,
        json({ rules: { "unused-key": "off" } }),
        "utf8",
      ),
    );
    await h.watched([
      { relativePath: "i18n-doctor.config.json", type: "created" },
    ]);

    expect(h.codesFor("locales/en.json")).not.toContain("unused-key");
  });
});

describe("client-provided settings", () => {
  it("applies initializationOptions on initialize", async () => {
    const root = await fixture(flatProject());
    const h = harness(root, {
      initializationOptions: {
        languageServer: { debounce: 275, logLevel: "warn" },
      },
    });
    await h.start();

    expect(h.core.settings()?.debounce).toBe(275);
    expect(h.core.logger.getLevel()).toBe("warn");
  });

  it("client settings win over the config file", async () => {
    const root = await fixture(
      flatProject({
        "i18n-doctor.config.json": json({
          languageServer: { debounce: 400 },
        }),
      }),
    );
    const h = harness(root, {
      initializationOptions: { languageServer: { debounce: 120 } },
    });
    await h.start();

    expect(h.core.settings()?.debounce).toBe(120);
  });

  it("applies workspace/didChangeConfiguration at runtime", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();
    expect(h.core.logger.getLevel()).toBe("silent");

    await h.configure({ languageServer: { logLevel: "debug", debounce: 200 } });

    expect(h.core.logger.getLevel()).toBe("debug");
    expect(h.core.settings()?.debounce).toBe(200);
  });

  it("re-analyzes after a configuration change", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);
    h.reset();

    await h.configure({ languageServer: { debounce: 0 } });

    // The analysis re-ran; nothing changed, so nothing was republished.
    expect(h.codesFor("src/Login.tsx")).toEqual(["missing-key"]);
    expect(h.publishes()).toEqual([]);
  });

  it("can disable the server at runtime and re-enable it", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);
    expect(h.codesFor("src/Login.tsx")).toEqual(["missing-key"]);

    await h.configure({ languageServer: { enabled: false } });
    expect(h.snapshot()).toEqual({});

    await h.configure({ languageServer: { enabled: true } });
    expect(h.codesFor("src/Login.tsx")).toEqual(["missing-key"]);
  });
});

describe("settings parsing", () => {
  const parse = (raw: unknown) => readLanguageServerSettings(raw);

  it("accepts a bare languageServer block", () => {
    expect(parse({ languageServer: { debounce: 250 } })?.debounce).toBe(250);
  });

  it("accepts the shapes IDE clients nest settings under", () => {
    for (const key of ["i18nDoctor", "i18n-doctor", "i18n_doctor"]) {
      expect(
        parse({ [key]: { languageServer: { logLevel: "info" } } })?.logLevel,
      ).toBe("info");
    }
  });

  it("returns undefined when there is nothing to apply", () => {
    expect(parse(undefined)).toBeUndefined();
    expect(parse(null)).toBeUndefined();
    expect(parse({})).toBeUndefined();
    expect(parse({ other: true })).toBeUndefined();
    expect(parse([1, 2, 3])).toBeUndefined();
    expect(parse("languageServer")).toBeUndefined();
  });

  it("reports invalid values and applies none of them", () => {
    const messages: string[] = [];
    const logger = createLogger({
      level: "debug",
      sink: { write: (_, message) => messages.push(message) },
    });

    const settings = readLanguageServerSettings(
      { languageServer: { debounce: "fast", logLevel: "loud" } },
      logger,
    );

    expect(settings).toBeUndefined();
    expect(messages.join("\n")).toMatch(/debounce/);
    expect(messages.join("\n")).toMatch(/logLevel/);
  });

  it("keeps the valid half of a partially invalid block", () => {
    const settings = parse({
      languageServer: { debounce: 250, logLevel: "nope" },
    });

    expect(settings).toEqual({ debounce: 250 });
  });

  it("uses the same validator as the config file", () => {
    const { config, diagnostics } = validateUserConfig({
      languageServer: { debounce: 250, logLevel: "warn" },
    });

    expect(diagnostics).toEqual([]);
    expect(config.languageServer).toEqual({ debounce: 250, logLevel: "warn" });
  });

  it("rejects a debounce outside the supported range", () => {
    expect(parse({ languageServer: { debounce: -50 } })).toBeUndefined();
    expect(parse({ languageServer: { debounce: 10_000_000 } })).toBeUndefined();
    // A rejected value leaves the default in place.
    expect(parse({ languageServer: { debounce: 60_000 } })?.debounce).toBe(
      60_000,
    );
    expect(DEFAULT_LANGUAGE_SERVER.debounce).toBe(250);
  });
});
