/**
 * Example CLI for @i18n-unused/config
 *
 *   npx tsx packages/config/examples/config-cli.ts <root>
 */

import path from "node:path";
import {
  createEffectiveConfigResolver,
  createIgnoreEngine,
  createSuppressionEngine,
} from "../src/index.js";

const rootArg = process.argv[2];
if (!rootArg) {
  console.error("Usage: npx tsx packages/config/examples/config-cli.ts <root>");
  process.exit(1);
}

const root = path.resolve(rootArg);
const resolver = createEffectiveConfigResolver();
const effective = resolver.resolve({
  root,
  cli: {
    // Example CLI override
    failOnWarning: false,
  },
});

console.log(`Root: ${effective.root}`);
console.log(`Config fragments: ${effective.fragments.length}`);
for (const f of effective.fragments) {
  console.log(`  [${f.source}] ${f.path ?? "(defaults/cli)"}`);
}
console.log(`ignoreKeys: ${JSON.stringify(effective.ignoreKeys)}`);
console.log(`ignoreFiles: ${JSON.stringify(effective.ignoreFiles)}`);
console.log(`include: ${JSON.stringify(effective.include)}`);
console.log(`exclude: ${JSON.stringify(effective.exclude)}`);
console.log(`rules: ${JSON.stringify(effective.rules.severities)}`);
console.log(
  `exit: exitOnError=${effective.exit.exitOnError} failOnWarning=${effective.exit.failOnWarning}`,
);
console.log(`output: ${JSON.stringify(effective.output)}`);
console.log(`fieldSources: ${JSON.stringify(effective.fieldSources)}`);

if (effective.diagnostics.length > 0) {
  console.log("\nDiagnostics:");
  for (const d of effective.diagnostics) {
    console.log(`  [${d.severity}] ${d.code}: ${d.message}`);
    if (d.hint) console.log(`    hint: ${d.hint}`);
  }
}

const ignore = createIgnoreEngine(effective);
console.log("\nIgnore samples:");
console.log(
  `  key "debug.foo":`,
  ignore.isKeyIgnored("debug.foo"),
);
console.log(
  `  file "src/generated/x.ts":`,
  ignore.shouldAnalyzeFile("src/generated/x.ts"),
);

const suppress = createSuppressionEngine();
const demo = suppress.parseFile({
  absolutePath: path.join(root, "demo.ts"),
  relativePath: "demo.ts",
  sourceText: `
const x = t('a'); // i18n-unused-ignore
/* i18n-unused-ignore-next-line */
const y = t('b');
/* i18n-unused-disable unused-key */
const z = t('c');
/* i18n-unused-enable */
`,
});
console.log("\nSuppression demo:");
for (const line of [2, 4, 6]) {
  const m = suppress.isSuppressed(demo, { line, rule: "unused-key" });
  console.log(`  line ${line}: suppressed=${m.suppressed} ${m.reason ?? ""}`);
}
