/**
 * End-to-end acceptance against the artifact the extension actually ships:
 * spawns the bundled `dist/server.js` as a real child process and speaks LSP
 * over stdio, exactly the way vscode-languageclient will.
 *
 * This is the packaging test — it proves the single-file bundle needs no
 * node_modules, no tsx, no repository paths.
 */

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const SERVER_BUNDLE = path.join(PACKAGE_ROOT, "dist", "server.js");

const LOGIN_TSX = `import { useTranslation } from "react-i18next";

export function Login() {
  const { t } = useTranslation();
  return <button title={t("auth.login")}>{t("auth.nonexistent")}</button>;
}
`;

interface Project {
  readonly root: string;
  write(relative: string, contents: string): void;
  remove(relative: string): void;
  uri(relative: string): string;
}

function makeProject(name: string, files: Record<string, string>): Project {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `i18n-vscode-${name}-`));
  const project: Project = {
    root,
    write(relative, contents) {
      const file = path.join(root, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, contents);
    },
    remove(relative) {
      fs.rmSync(path.join(root, relative), { force: true });
    },
    uri(relative) {
      return pathToFileURL(path.join(root, relative)).href;
    },
  };
  for (const [relative, contents] of Object.entries(files)) {
    project.write(relative, contents);
  }
  return project;
}

function flatFiles(): Record<string, string> {
  return {
    "package.json": JSON.stringify({
      name: "demo",
      dependencies: { i18next: "^23.0.0", "react-i18next": "^14.0.0" },
    }),
    "locales/en.json": JSON.stringify(
      { auth: { login: "Login", logout: "Logout" } },
      null,
      2,
    ),
    "locales/fa.json": JSON.stringify(
      { auth: { login: "ورود", logout: "خروج" } },
      null,
      2,
    ),
    "src/Login.tsx": LOGIN_TSX,
  };
}

interface PublishParams {
  uri: string;
  version?: number;
  diagnostics: {
    code?: string | number;
    message: string;
    source?: string;
    severity?: number;
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  }[];
}

interface Client {
  child: ChildProcess;
  connection: MessageConnection;
  stderr(): string;
  waitFor(
    predicate: (params: PublishParams) => boolean,
    label: string,
  ): Promise<PublishParams>;
  exitCode(): Promise<number | null>;
}

let clients: Client[] = [];

function connect(): Client {
  const child = spawn(process.execPath, [SERVER_BUNDLE, "--stdio"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stderrChunks: Buffer[] = [];
  child.stderr!.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  const connection = createMessageConnection(
    new StreamMessageReader(child.stdout!),
    new StreamMessageWriter(child.stdin!),
  );

  const published: PublishParams[] = [];
  const waiters: {
    predicate: (params: PublishParams) => boolean;
    resolve: (params: PublishParams) => void;
  }[] = [];
  connection.onNotification(
    "textDocument/publishDiagnostics",
    (params: PublishParams) => {
      published.push(params);
      for (const waiter of [...waiters]) {
        if (!waiter.predicate(params)) continue;
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(params);
      }
    },
  );
  connection.listen();

  const exited = new Promise<number | null>((resolve) => {
    child.on("exit", (code) => resolve(code));
  });

  const client: Client = {
    child,
    connection,
    stderr: () => Buffer.concat(stderrChunks).toString("utf8"),
    waitFor(predicate, label) {
      const existing = [...published].reverse().find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`timed out waiting for ${label}`)),
          15_000,
        );
        waiters.push({
          predicate,
          resolve: (params) => {
            clearTimeout(timer);
            resolve(params);
          },
        });
      });
    },
    exitCode: () => exited,
  };
  clients.push(client);
  return client;
}

const hasCode =
  (uri: string, code: string) =>
  (params: PublishParams): boolean =>
    params.uri === uri && params.diagnostics.some((d) => d.code === code);

const isEmpty =
  (uri: string) =>
  (params: PublishParams): boolean =>
    params.uri === uri && params.diagnostics.length === 0;

async function initialize(
  client: Client,
  roots: string[],
  initializationOptions?: unknown,
): Promise<unknown> {
  const result: unknown = await client.connection.sendRequest("initialize", {
    processId: process.pid,
    rootUri: null,
    capabilities: { workspace: { workspaceFolders: true } },
    workspaceFolders: roots.map((root) => ({
      uri: pathToFileURL(root).href,
      name: path.basename(root),
    })),
    ...(initializationOptions !== undefined ? { initializationOptions } : {}),
  });
  await client.connection.sendNotification("initialized", {});
  return result;
}

function open(client: Client, uri: string, text: string): Promise<void> {
  return client.connection.sendNotification("textDocument/didOpen", {
    textDocument: { uri, languageId: "typescriptreact", version: 1, text },
  });
}

function notifyWatched(
  client: Client,
  uri: string,
  type: 1 | 2 | 3,
): Promise<void> {
  return client.connection.sendNotification("workspace/didChangeWatchedFiles", {
    changes: [{ uri, type }],
  });
}

beforeAll(() => {
  const serverDist = path.resolve(
    PACKAGE_ROOT,
    "..",
    "language-server",
    "dist",
    "bin.js",
  );
  if (!fs.existsSync(serverDist)) {
    throw new Error(
      "Build the monorepo first (npm run build): missing " + serverDist,
    );
  }
  execFileSync(process.execPath, [path.join(PACKAGE_ROOT, "scripts/build.mjs")], {
    cwd: PACKAGE_ROOT,
    stdio: "ignore",
  });
}, 120_000);

afterEach(async () => {
  for (const client of clients) {
    client.connection.dispose();
    if (client.child.exitCode === null) client.child.kill("SIGKILL");
    await client.exitCode();
  }
  clients = [];
});

describe("bundled server end-to-end", () => {
  it("runs the full acceptance cycle: appear → fix → reappear", async () => {
    const project = makeProject("flat", flatFiles());
    const uri = project.uri("src/Login.tsx");
    const client = connect();

    await initialize(client, [project.root]);
    await open(client, uri, LOGIN_TSX);

    // 1. The diagnostic appears, underlining exactly "auth.nonexistent".
    const params = await client.waitFor(
      hasCode(uri, "missing-key"),
      "missing-key diagnostic",
    );
    const diagnostic = params.diagnostics.find((d) => d.code === "missing-key")!;
    expect(diagnostic.source).toBe("i18n-doctor");
    expect(diagnostic.message).toBe(
      'Translation key "auth.nonexistent" does not exist.',
    );
    expect(diagnostic.severity).toBe(1);
    const line = LOGIN_TSX.split("\n")[diagnostic.range.start.line]!;
    expect(
      line.slice(diagnostic.range.start.character, diagnostic.range.end.character),
    ).toBe('"auth.nonexistent"');

    // 2. Adding the key to the locale files clears it automatically.
    const withKey = (label: string): string =>
      JSON.stringify(
        { auth: { login: label, logout: label, nonexistent: label } },
        null,
        2,
      );
    project.write("locales/en.json", withKey("x"));
    project.write("locales/fa.json", withKey("y"));
    await notifyWatched(client, project.uri("locales/en.json"), 2);
    await notifyWatched(client, project.uri("locales/fa.json"), 2);
    await client.waitFor(isEmpty(uri), "diagnostic cleared after key added");

    // 3. Removing the key brings the diagnostic back.
    const files = flatFiles();
    project.write("locales/en.json", files["locales/en.json"]!);
    project.write("locales/fa.json", files["locales/fa.json"]!);
    await notifyWatched(client, project.uri("locales/en.json"), 2);
    await notifyWatched(client, project.uri("locales/fa.json"), 2);
    const back = await client.waitFor(
      hasCode(uri, "missing-key"),
      "diagnostic returned after key removed",
    );
    expect(back.diagnostics.some((d) => d.code === "missing-key")).toBe(true);
  }, 60_000);

  it("handles a multi-root workspace, analyzing every folder", async () => {
    const first = makeProject("a", flatFiles());
    const second = makeProject("b", flatFiles());
    const client = connect();

    await initialize(client, [first.root, second.root]);
    await open(client, first.uri("src/Login.tsx"), LOGIN_TSX);
    await open(client, second.uri("src/Login.tsx"), LOGIN_TSX);

    await client.waitFor(
      hasCode(first.uri("src/Login.tsx"), "missing-key"),
      "diagnostic in first root",
    );
    await client.waitFor(
      hasCode(second.uri("src/Login.tsx"), "missing-key"),
      "diagnostic in second root",
    );
  }, 60_000);

  it("honors initializationOptions the way the extension sends them", async () => {
    const project = makeProject("opts", flatFiles());
    const uri = project.uri("src/Login.tsx");
    const client = connect();

    // enabled:false is what i18nDoctor.enabled=false forwards.
    await initialize(client, [project.root], {
      languageServer: { enabled: false, debounce: 0 },
    });
    await open(client, uri, LOGIN_TSX);

    // The server acknowledges but publishes nothing; give it a beat.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const diagnostic = await Promise.race([
      client.waitFor(hasCode(uri, "missing-key"), "should not appear"),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 500)),
    ]);
    expect(diagnostic).toBeUndefined();
  }, 60_000);

  it("shuts down cleanly with exit code 0 and a quiet stderr", async () => {
    const project = makeProject("exit", flatFiles());
    const client = connect();

    await initialize(client, [project.root]);
    await open(client, project.uri("src/Login.tsx"), LOGIN_TSX);
    await client.waitFor(
      hasCode(project.uri("src/Login.tsx"), "missing-key"),
      "diagnostic before shutdown",
    );

    await client.connection.sendRequest("shutdown");
    await client.connection.sendNotification("exit");

    expect(await client.exitCode()).toBe(0);
    expect(client.stderr()).toBe("");
  }, 60_000);
});
