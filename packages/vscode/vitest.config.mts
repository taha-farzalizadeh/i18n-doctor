import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // The real `vscode` module only exists inside the extension host, so
      // tests that must load client.ts (or vscode-languageclient) hit this
      // stand-in instead.
      vscode: path.resolve(root, "tests/mocks/vscode.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: "forks",
    sequence: {
      concurrent: false,
    },
    // Lifecycle/unit suites never import vscode-languageclient; e2e talks to
    // the bundled server over stdio and needs no special Vite transform.
  },
});
