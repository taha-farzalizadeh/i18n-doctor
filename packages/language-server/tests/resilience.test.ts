import { describe, expect, it } from "vitest";
import { flatProject, LOGIN_TSX } from "./fixtures.js";
import { find, fixture, harness, json, writeFiles } from "./helpers.js";
import { createLogger, describeError, type LogLevel } from "../src/logger.js";

describe("malformed source files", () => {
  it("survives a file that cannot be parsed and keeps analyzing the rest", async () => {
    const root = await fixture(
      flatProject({
        "src/Broken.tsx": `import { t } from "i18next";
export const Broken = () => t("auth.login"  // unterminated call
`,
      }),
    );
    const h = harness(root);
    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);

    expect(h.core.state).toBe("initialized");
    // The healthy file is still analyzed.
    expect(h.codesFor("src/Login.tsx")).toContain("missing-key");
  });

  it("recovers when a document is mid-edit and temporarily invalid", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();

    // A half-typed call expression.
    await h.open("src/Login.tsx", `import { t } from "i18next";\nt("auth.\n`);
    expect(h.core.state).toBe("initialized");

    await h.change(
      "src/Login.tsx",
      `import { t } from "i18next";\nt("auth.login");\n`,
      3,
    );
    expect(h.diagnosticsFor("src/Login.tsx")).toEqual([]);
  });

  it("keeps serving diagnostics for a file with unsupported syntax nearby", async () => {
    const root = await fixture(
      flatProject({
        "src/weird.txt": "this is not code at all { [ ",
        "src/Login.tsx": LOGIN_TSX,
      }),
    );
    const h = harness(root);
    await h.start();

    expect(h.codesFor("src/Login.tsx")).toContain("missing-key");
    expect(h.diagnosticsFor("src/weird.txt")).toEqual([]);
  });
});

describe("malformed translation files", () => {
  it("does not crash on invalid JSON in a catalog", async () => {
    const root = await fixture(
      flatProject({ "locales/en.json": '{ "auth": { "login": ' }),
    );
    const h = harness(root);
    await h.start();

    expect(h.core.state).toBe("initialized");
    // The other locale is still readable, so analysis continues.
    expect(h.diagnosticsFor("locales/fa.json")).toBeDefined();
  });

  it("recovers once the JSON is valid again", async () => {
    const root = await fixture(
      flatProject({ "locales/en.json": '{ "auth": { "login":' }),
    );
    const h = harness(root);
    await h.start();

    await writeFiles(root, {
      "locales/en.json": json({ auth: { login: "Login", logout: "Log out" } }),
    });
    await h.watched([{ relativePath: "locales/en.json", type: "changed" }]);

    expect(
      find(h.diagnosticsFor("locales/en.json"), "unused-key", "auth.logout"),
    ).toBeDefined();
  });

  it("tolerates invalid JSON typed into an open catalog buffer", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();

    await h.open("locales/en.json", '{ "auth": { "login": "Login", ');
    expect(h.core.state).toBe("initialized");

    await h.change("locales/en.json", json({ auth: { login: "Login" } }), 2);
    expect(h.core.state).toBe("initialized");
  });

  it("tolerates an empty catalog file", async () => {
    const root = await fixture(flatProject({ "locales/empty.json": "" }));
    const h = harness(root);
    await h.start();

    expect(h.core.state).toBe("initialized");
    expect(h.diagnosticsFor("locales/empty.json")).toEqual([]);
  });

  it("tolerates a catalog module that throws at import time", async () => {
    const root = await fixture(
      flatProject({
        "locales/broken.ts": `throw new Error("boom");\nexport default {};\n`,
      }),
    );
    const h = harness(root);
    await h.start();

    expect(h.core.state).toBe("initialized");
    expect(h.codesFor("src/Login.tsx")).toContain("missing-key");
  });
});

describe("project-level failures", () => {
  it("initializes a directory with no package.json", async () => {
    const root = await fixture({ "src/App.tsx": "export const A = () => null;\n" });
    const h = harness(root);

    await expect(h.start()).resolves.toBeUndefined();
    expect(h.core.state).toBe("initialized");
    expect(h.snapshot()).toEqual({});
  });

  it("initializes an empty directory", async () => {
    const root = await fixture({});
    const h = harness(root);

    await h.start();

    expect(h.core.state).toBe("initialized");
    expect(h.snapshot()).toEqual({});
  });

  it("survives a root that does not exist", async () => {
    const root = await fixture({});
    const h = harness(`${root}/does-not-exist`);

    await expect(h.start()).resolves.toBeUndefined();
    expect(h.core.state).toBe("initialized");
  });

  it("survives a malformed config file", async () => {
    const root = await fixture(
      flatProject({ "i18n-doctor.config.json": "{ not json" }),
    );
    const h = harness(root);

    await h.start();

    expect(h.core.state).toBe("initialized");
  });

  it("survives a config file with invalid option values", async () => {
    const root = await fixture(
      flatProject({
        "i18n-doctor.config.json": json({
          languageServer: { debounce: "very fast", logLevel: "loud" },
        }),
      }),
    );
    const h = harness(root);

    await h.start();

    // Invalid values are reported by the config layer and defaults are used.
    expect(h.core.state).toBe("initialized");
    expect(h.codesFor("src/Login.tsx")).toContain("missing-key");
  });

  it("ignores notifications that arrive before initialize", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);

    expect(() => {
      h.core.didOpen({
        textDocument: {
          uri: h.uri("src/Login.tsx"),
          languageId: "typescriptreact",
          version: 1,
          text: LOGIN_TSX,
        },
      });
      h.core.didChangeConfiguration({ settings: {} });
      h.core.didChangeWatchedFiles({ changes: [] });
    }).not.toThrow();
    await h.settle();
    expect(h.publishes()).toEqual([]);
  });

  it("ignores notifications that arrive after shutdown", async () => {
    const root = await fixture(flatProject());
    const h = harness(root);
    await h.start();
    await h.core.shutdown();
    h.reset();

    await h.open("src/Login.tsx", LOGIN_TSX);

    expect(h.publishes()).toEqual([]);
    expect(h.core.state).toBe("shutdown");
  });

  it("keeps running when the client's publish callback throws", async () => {
    const root = await fixture(flatProject());
    let calls = 0;
    const h = harness(root, {
      onPublish: () => {
        calls += 1;
        throw new Error("transport closed");
      },
    });

    await h.start();
    await h.open("src/Login.tsx", LOGIN_TSX);

    expect(calls).toBeGreaterThan(0);
    expect(h.core.state).toBe("initialized");
  });
});

describe("logging", () => {
  it("routes messages through the sink, never stdout", () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: "debug",
      sink: { write: (level, message) => lines.push(`${level}:${message}`) },
      scope: "test",
    });

    logger.error("bad");
    logger.warn("hmm");
    logger.info("fyi");
    logger.debug("details");

    expect(lines).toEqual([
      "error:[test] bad",
      "warn:[test] hmm",
      "info:[test] fyi",
      "debug:[test] details",
    ]);
  });

  it("honours each log level", () => {
    const captured = (level: LogLevel): string[] => {
      const lines: string[] = [];
      const logger = createLogger({
        level,
        sink: { write: (_, message) => lines.push(message) },
      });
      logger.error("e");
      logger.warn("w");
      logger.info("i");
      logger.debug("d");
      return lines;
    };

    expect(captured("silent")).toEqual([]);
    expect(captured("error")).toEqual(["e"]);
    expect(captured("warn")).toEqual(["e", "w"]);
    expect(captured("info")).toEqual(["e", "w", "i"]);
    expect(captured("debug")).toEqual(["e", "w", "i", "d"]);
  });

  it("nests scopes for child loggers", () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: "info",
      sink: { write: (_, message) => lines.push(message) },
      scope: "ls",
    });

    logger.child("project").child("scope").info("ready");

    expect(lines).toEqual(["[ls:project:scope] ready"]);
  });

  it("survives a sink that throws", () => {
    const logger = createLogger({
      level: "debug",
      sink: {
        write: () => {
          throw new Error("pipe closed");
        },
      },
    });

    expect(() => logger.error("still alive")).not.toThrow();
  });

  it("describes any thrown value as a non-empty string", () => {
    expect(describeError(new Error("plain"))).toBe("plain");
    expect(describeError(new TypeError())).toBe("TypeError");
    expect(describeError("string failure")).toBe("string failure");
    expect(describeError({ code: "ENOENT" })).toBe('{"code":"ENOENT"}');
    expect(describeError(undefined)).toBe("undefined");
    // Circular structures fall back to String() rather than throwing.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(describeError(circular)).toBe("[object Object]");
  });

  it("changes level at runtime", () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: "error",
      sink: { write: (_, message) => lines.push(message) },
    });

    logger.debug("hidden");
    logger.setLevel("debug");
    logger.debug("shown");

    expect(lines).toEqual(["shown"]);
    expect(logger.getLevel()).toBe("debug");
  });
});
