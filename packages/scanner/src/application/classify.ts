import type {
  FileLanguage,
  FileRole,
  SyntaxDomain,
} from "../domain/file-kinds.js";
import { basenamePosix, extensionOf } from "../domain/path-utils.js";

const SCRIPT_JS = new Set(["js", "jsx", "mjs", "cjs"]);
const SCRIPT_TS = new Set(["ts", "tsx"]);
const RESOURCE = new Set(["json", "yaml", "yml"]);

const CONFIG_NAMES = new Set([
  "package.json",
  "tsconfig.json",
  "jsconfig.json",
  "pnpm-workspace.yaml",
  "lerna.json",
  "nx.json",
  "turbo.json",
  "angular.json",
]);

const GENERATED_SEGMENTS = new Set([
  "dist",
  "build",
  "out",
  "coverage",
  "generated",
  ".next",
  ".nuxt",
  ".output",
  ".turbo",
]);

export function classifyExtension(relativePath: string): {
  extension: string;
  language: FileLanguage;
  syntaxDomain: SyntaxDomain;
} {
  const extension = extensionOf(relativePath);

  if (SCRIPT_JS.has(extension)) {
    return { extension, language: "javascript", syntaxDomain: "script" };
  }
  if (SCRIPT_TS.has(extension)) {
    return { extension, language: "typescript", syntaxDomain: "script" };
  }
  if (extension === "vue") {
    return { extension, language: "vue", syntaxDomain: "mixed" };
  }
  if (extension === "svelte") {
    return { extension, language: "svelte", syntaxDomain: "mixed" };
  }
  if (extension === "astro") {
    return { extension, language: "astro", syntaxDomain: "mixed" };
  }
  if (extension === "mdx") {
    return { extension, language: "markdown-mdx", syntaxDomain: "mixed" };
  }
  if (extension === "json") {
    return { extension, language: "json", syntaxDomain: "resource" };
  }
  if (extension === "yaml" || extension === "yml") {
    return { extension, language: "yaml", syntaxDomain: "resource" };
  }
  return { extension, language: "unknown", syntaxDomain: "resource" };
}

export function classifyRole(relativePath: string): FileRole {
  const base = basenamePosix(relativePath);
  if (CONFIG_NAMES.has(base) || /\.config\./.test(base) || base.startsWith("tsconfig")) {
    return "config";
  }

  const segments = relativePath.split("/");
  for (const segment of segments) {
    if (GENERATED_SEGMENTS.has(segment)) {
      return "generated";
    }
  }

  const { syntaxDomain, language } = classifyExtension(relativePath);
  if (syntaxDomain === "resource" || RESOURCE.has(extensionOf(relativePath))) {
    if (language === "json" || language === "yaml") {
      return "resource";
    }
  }

  if (
    language === "javascript" ||
    language === "typescript" ||
    language === "vue" ||
    language === "svelte" ||
    language === "astro" ||
    language === "markdown-mdx"
  ) {
    return "source";
  }

  return "unknown";
}

export function isHiddenName(name: string): boolean {
  return name.startsWith(".") && name !== "." && name !== "..";
}
