import fs from "fs";

const base = ["i18n", "i18n-doctor", "localization", "translation", "static-analysis", "unused-keys", "missing-keys"];

const packages = {
  ast:       { keywords: [...base, "ast", "typescript", "parser", "traversal"], desc: "TypeScript Compiler API based AST engine — parse JS/JSX/TS/TSX, traverse nodes, and query the syntax tree." },
  scanner:   { keywords: [...base, "scanner", "files", "glob"], desc: "File system scanner — discover project files and produce normalized path snapshots." },
  constants: { keywords: [...base, "constants", "evaluation", "static"], desc: "Static constant evaluator — resolves constant values used as translation keys." },
  imports:   { keywords: [...base, "imports", "module-graph", "resolution"], desc: "Cross-file import/export resolution and module graph construction." },
  detect:    { keywords: [...base, "detect", "framework", "react", "vue", "next", "i18next"], desc: "Auto-detect the framework, i18n library, and language used in a project." },
  templates: { keywords: [...base, "templates", "jsx", "vue", "template-literal"], desc: "Framework template analyzers for extracting translation key usages." },
  resolve:   { keywords: [...base, "resolve", "alias", "variables"], desc: "File-local alias and variable resolution for translation usage detection." },
  callgraph: { keywords: [...base, "callgraph", "call-graph", "wrapper", "propagation"], desc: "Call graph construction and translation wrapper function detection." },
  config:    { keywords: [...base, "config", "configuration", "ignore", "suppression"], desc: "Configuration loading, ignore rules, and inline suppression engine." },
  dataflow:  { keywords: [...base, "dataflow", "dynamic-keys", "data-flow"], desc: "Dynamic key analysis and basic data-flow tracking for translation keys." },
  context:   { keywords: [...base, "context", "namespace", "locale"], desc: "Namespace, locale, and configuration context intelligence for key resolution." },
  sources:   { keywords: [...base, "sources", "catalog", "json", "yaml", "locale-files"], desc: "Translation source discovery and key catalog extraction from JSON/YAML locale files." },
  usages:    { keywords: [...base, "usages", "usage-detection", "react", "vue", "angular"], desc: "Translation key usage detection across React, Vue, Angular, and more." },
  coverage:  { keywords: [...base, "coverage", "locale-coverage", "consistency"], desc: "Cross-locale coverage analysis — finds keys missing in some locales." },
  issues:    { keywords: [...base, "issues", "reporters", "sarif", "json", "markdown"], desc: "Issue engine and multi-format reporters (terminal, JSON, SARIF, Markdown, HTML)." },
  cli:       { keywords: [...base, "cli", "command-line", "npx", "check", "lint"], desc: "CLI for i18n-doctor — run `npx i18n-doctor check` to find unused, missing, and duplicate translation keys in your project." },
};

for (const [pkg, { keywords, desc }] of Object.entries(packages)) {
  // Update package.json keywords
  const pkgPath = `packages/${pkg}/package.json`;
  const p = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  p.keywords = keywords;
  fs.writeFileSync(pkgPath, JSON.stringify(p, null, 2) + "\n");

  // Write README.md
  const isCli = pkg === "cli";
  const readme = isCli ? `# @i18n-doctor/cli

> **Beta — v0.9.0** · [GitHub](https://github.com/taha-farzalizadeh/i18n-doctor) · [Issues](https://github.com/taha-farzalizadeh/i18n-doctor/issues)

Static localization analysis for JavaScript and TypeScript projects.  
Finds **unused**, **missing**, and **duplicate** translation keys — without executing your code.

## Install & run

\`\`\`bash
# Run without installing
npx i18n-doctor check

# Install globally
npm install -g @i18n-doctor/cli
i18n-doctor check
\`\`\`

## Usage

\`\`\`
i18n-doctor check [path] [options]

Options:
  --json          JSON report
  --sarif         SARIF 2.1.0 report
  --markdown      Markdown report
  --html          HTML report
  --silent        Exit code only, no output
  --verbose       Show timings
  --config        Path to config file
  --locale        Restrict to one locale
  --namespace     Restrict to one namespace
  --base-locale   Base locale for cross-locale coverage
  --no-coverage   Skip locale consistency analysis
\`\`\`

## Exit codes

| Code | Meaning |
|---:|---|
| 0 | No failing issues |
| 1 | Issues found that fail the exit policy |
| 2 | Config, I/O, or permission error |

## Contributing

This is a beta release. Bug reports, feature requests, and pull requests are very welcome.  
See the [GitHub repo](https://github.com/taha-farzalizadeh/i18n-doctor) to get started.

## License

MIT
` : `# @i18n-doctor/${pkg}

> Part of [i18n-doctor](https://github.com/taha-farzalizadeh/i18n-doctor) — static localization analysis for JavaScript and TypeScript.

${desc}

This package is an internal engine module. Most users only need the CLI:

\`\`\`bash
npx i18n-doctor check
\`\`\`

## License

MIT
`;

  fs.writeFileSync(`packages/${pkg}/README.md`, readme);
  console.log(`✓ ${pkg}`);
}
