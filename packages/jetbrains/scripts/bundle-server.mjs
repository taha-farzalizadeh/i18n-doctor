/**
 * Bundles @i18n-doctor/language-server (and its full dependency graph) into a
 * single CommonJS file the JetBrains plugin ships and launches with Node.
 *
 * Same strategy as packages/vscode/scripts/build.mjs — a fresh plugin install
 * needs no node_modules in the user's project and no global language-server.
 */

import { build } from "esbuild";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outfile = path.join(root, "src/main/resources/server/server.js");

const importMetaUrlShim = {
  js: "const import_meta_url = require('node:url').pathToFileURL(__filename).href;",
};

fs.mkdirSync(path.dirname(outfile), { recursive: true });

await build({
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  mainFields: ["module", "main"],
  sourcemap: false,
  logLevel: "info",
  define: { "import.meta.url": "import_meta_url" },
  banner: importMetaUrlShim,
  entryPoints: [require.resolve("@i18n-doctor/language-server/bin")],
  outfile,
});

const sizeMb = (fs.statSync(outfile).size / (1024 * 1024)).toFixed(1);
console.log(`Bundled language server → ${outfile} (${sizeMb} MB)`);
