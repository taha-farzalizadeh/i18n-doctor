/**
 * Example CLI for @i18n-doctor/context
 *
 *   npx tsx packages/context/examples/context-cli.ts <root>
 */

import path from "node:path";
import { createContextAnalyzer } from "../src/index.js";

const rootArg = process.argv[2];

if (!rootArg) {
  console.error(
    "Usage: npx tsx packages/context/examples/context-cli.ts <root>",
  );
  process.exit(1);
}

const root = path.resolve(rootArg);
const analyzer = createContextAnalyzer({ root });
const contexts = analyzer.analyzeMonorepo();

for (const ctx of contexts) {
  console.log(`\n=== ${ctx.packageRoot ?? ctx.root} ===`);
  console.log(`Configs: ${ctx.configs.length}`);
  for (const c of ctx.configs) {
    console.log(
      `  [${c.kind}/${c.library}] ${c.relativePath} conf=${c.confidence}`,
    );
    if (c.defaultNS !== undefined) console.log(`    defaultNS=${JSON.stringify(c.defaultNS)}`);
    if (c.ns !== undefined) console.log(`    ns=${JSON.stringify(c.ns)}`);
    if (c.defaultLocale !== undefined) console.log(`    defaultLocale=${c.defaultLocale}`);
    if (c.supportedLocales !== undefined) {
      console.log(`    locales=${JSON.stringify(c.supportedLocales)}`);
    }
  }

  const e = ctx.effective;
  console.log("Effective:");
  console.log(`  defaultNS=${e.defaultNS ?? "-"}`);
  console.log(`  namespaces=${JSON.stringify(e.namespaces ?? [])}`);
  console.log(`  defaultLocale=${e.defaultLocale ?? "-"}`);
  console.log(`  fallbackLocales=${JSON.stringify(e.fallbackLocales ?? [])}`);
  console.log(`  supportedLocales=${JSON.stringify(e.supportedLocales ?? [])}`);
  console.log(`  confidence=${e.confidence}`);
  if (e.conflicts.length > 0) {
    console.log(`  conflicts=${e.conflicts.length}`);
    for (const c of e.conflicts) {
      console.log(`    - ${c.message}`);
    }
  }

  // Demo resolution
  const resolved = analyzer.resolveUsage(
    {
      key: "login.title",
      absolutePath: path.join(ctx.root, "src/App.tsx"),
      relativePath: "src/App.tsx",
      location: {
        line: 1,
        column: 1,
        endLine: 1,
        endColumn: 12,
        start: 0,
        end: 12,
      },
      callSiteNamespace: "auth",
      keyPrefix: "form",
      library: "react-i18next",
    },
    { context: ctx },
  );
  console.log("Sample resolveUsage:");
  console.log(
    `  ${resolved.originalKey} → ${resolved.resolvedKey} ns=${resolved.namespace} locale=${resolved.locale} via=${resolved.resolutionSource} conf=${resolved.confidence}`,
  );
}
