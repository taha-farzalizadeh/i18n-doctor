/**
 * Headless acceptance: bundled server + demo project, no WebStorm required.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverJs = path.join(root, "src/main/resources/server/server.js");
const demoSrc = path.join(root, "examples/demo-project");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function uriFor(p) {
  return pathToFileURL(path.resolve(p)).href;
}

async function withServer(workspaceRoot, fn) {
  assert(fs.existsSync(serverJs), `missing bundled server at ${serverJs}`);
  const child = spawn(process.execPath, [serverJs, "--stdio"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));

  const connection = createMessageConnection(
    new StreamMessageReader(child.stdout),
    new StreamMessageWriter(child.stdin),
  );

  /** @type {{ uri: string, diagnostics: any[] }[]} */
  const published = [];
  /** @type {{ predicate: Function, resolve: Function, reject: Function, timer: any }[]} */
  const waiters = [];

  connection.onNotification("textDocument/publishDiagnostics", (params) => {
    published.push(params);
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(params)) continue;
      waiters.splice(waiters.indexOf(waiter), 1);
      clearTimeout(waiter.timer);
      waiter.resolve(params);
    }
  });

  // Acknowledge dynamic capability registrations so the server does not stall.
  connection.onRequest("client/registerCapability", () => null);
  connection.listen();

  const waitFor = (predicate, label, timeoutMs = 20_000) => {
    const existing = [...published].reverse().find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for ${label}`)),
        timeoutMs,
      );
      waiters.push({ predicate, resolve, reject, timer });
    });
  };

  try {
    await fn({ connection, waitFor, workspaceRoot });
  } finally {
    try {
      await connection.sendRequest("shutdown");
      connection.sendNotification("exit");
    } catch {
      // ignore
    }
    connection.dispose();
    if (!child.killed) child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 100));
    if (stderr.length) process.stderr.write(stderr.join(""));
  }
}

function withKey(label) {
  return `${JSON.stringify(
    { auth: { login: label, logout: label, nonexistent: label } },
    null,
    2,
  )}\n`;
}

function withoutKey(label) {
  return `${JSON.stringify(
    { auth: { login: label, logout: label } },
    null,
    2,
  )}\n`;
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-doctor-jb-e2e-"));
  fs.cpSync(demoSrc, tmp, { recursive: true });

  const loginPath = path.join(tmp, "src/Login.tsx");
  const enPath = path.join(tmp, "locales/en.json");
  const faPath = path.join(tmp, "locales/fa.json");
  const loginUri = uriFor(loginPath);
  const enUri = uriFor(enPath);
  const faUri = uriFor(faPath);
  const loginText = fs.readFileSync(loginPath, "utf8");

  const hasCode = (uri, code) => (params) =>
    params.uri === uri && params.diagnostics.some((d) => d.code === code);
  const isEmpty = (uri) => (params) =>
    params.uri === uri && params.diagnostics.length === 0;
  const noCode = (uri, code) => (params) =>
    params.uri === uri && !params.diagnostics.some((d) => d.code === code);

  await withServer(tmp, async ({ connection, waitFor }) => {
    const init = await connection.sendRequest("initialize", {
      processId: process.pid,
      rootUri: null,
      capabilities: {
        workspace: {
          workspaceFolders: true,
          didChangeWatchedFiles: { dynamicRegistration: true },
        },
      },
      workspaceFolders: [{ uri: uriFor(tmp), name: "demo" }],
      initializationOptions: { languageServer: { debounce: 50 } },
    });
    assert(init?.capabilities, "initialize must return capabilities");
    connection.sendNotification("initialized", {});

    connection.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: loginUri,
        languageId: "typescriptreact",
        version: 1,
        text: loginText,
      },
    });

    const missing = await waitFor(hasCode(loginUri, "missing-key"), "missing-key");
    const diagnostic = missing.diagnostics.find((d) => d.code === "missing-key");
    assert(diagnostic, "expected missing-key diagnostic");
    const line = loginText.split(/\n/)[diagnostic.range.start.line];
    const underlined = line.slice(
      diagnostic.range.start.character,
      diagnostic.range.end.character,
    );
    assert(
      underlined === '"auth.nonexistent"',
      `range must underline the key literal, got ${JSON.stringify(underlined)}`,
    );

    // Unsaved locale buffer with the key present → diagnostic clears.
    const enWith = withKey("en");
    connection.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: enUri,
        languageId: "json",
        version: 1,
        text: enWith,
      },
    });
    await waitFor(noCode(loginUri, "missing-key"), "cleared after locale open");

    // Remove from the open buffer → diagnostic returns.
    connection.sendNotification("textDocument/didChange", {
      textDocument: { uri: enUri, version: 2 },
      contentChanges: [{ text: withoutKey("en") }],
    });
    await waitFor(hasCode(loginUri, "missing-key"), "returned after locale edit");

    // Disk + watched-files path (what IDE file watchers send).
    fs.writeFileSync(enPath, withKey("en"));
    fs.writeFileSync(faPath, withKey("fa"));
    await connection.sendNotification("workspace/didChangeWatchedFiles", {
      changes: [
        { uri: enUri, type: 2 },
        { uri: faUri, type: 2 },
      ],
    });
    // Close the stale overlay so disk content wins.
    connection.sendNotification("textDocument/didClose", {
      textDocument: { uri: enUri },
    });
    await waitFor(noCode(loginUri, "missing-key"), "cleared after watched files");

    // Unsaved source buffer fix.
    const fixed = loginText.replace("auth.nonexistent", "auth.login");
    connection.sendNotification("textDocument/didChange", {
      textDocument: { uri: loginUri, version: 2 },
      contentChanges: [{ text: fixed }],
    });
    await waitFor(isEmpty(loginUri), "source buffer fixed");
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("jetbrains e2e: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
