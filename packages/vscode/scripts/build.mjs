/**
 * Bundles the extension for distribution.
 *
 * Two artifacts, both fully self-contained:
 *
 *   dist/extension.js  — the VS Code extension entry (externals: `vscode` only)
 *   dist/server.js     — the whole @i18n-doctor/language-server plus its
 *                        dependency graph (typescript, vscode-languageserver,
 *                        every @i18n-doctor package) as one CommonJS file, so a
 *                        fresh .vsix install needs no node_modules anywhere.
 *
 * The analyzer only uses `ts.createSourceFile` (no type checker, no lib.d.ts
 * lookups), so bundling the TypeScript compiler is safe.
 */

import { build } from "esbuild";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A few transitive modules resolve their own package.json through
 * `import.meta.url`; this shim keeps that working from a CJS bundle.
 */
const importMetaUrlShim = {
  js: "const import_meta_url = require('node:url').pathToFileURL(__filename).href;",
};

const common = {
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  // Prefer ESM entries: jsonc-parser's UMD `main` leaks a runtime
  // `require("./impl/…")` that breaks a self-contained bundle.
  mainFields: ["module", "main"],
  sourcemap: true,
  logLevel: "info",
  define: { "import.meta.url": "import_meta_url" },
  banner: importMetaUrlShim,
};

await build({
  ...common,
  entryPoints: [path.join(root, "src/extension.ts")],
  outfile: path.join(root, "dist/extension.js"),
  external: ["vscode"],
});

await build({
  ...common,
  entryPoints: [require.resolve("@i18n-doctor/language-server/bin")],
  outfile: path.join(root, "dist/server.js"),
});
