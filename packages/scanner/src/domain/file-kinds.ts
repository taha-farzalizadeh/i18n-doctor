/** Coarse language classification (non-parsing). */
export type FileLanguage =
  | "javascript"
  | "typescript"
  | "vue"
  | "svelte"
  | "astro"
  | "json"
  | "yaml"
  | "markdown-mdx"
  | "unknown";

/**
 * Syntax domain for downstream parser facade handoff.
 * Scanner assigns this heuristically; it does not parse.
 */
export type SyntaxDomain = "script" | "template" | "resource" | "mixed";

/** File role heuristic derived from path/glob only. */
export type FileRole =
  | "source"
  | "config"
  | "resource"
  | "generated"
  | "unknown";

/** Default extensions discovered by the scanner plan. */
export type SupportedExtension =
  | "js"
  | "jsx"
  | "ts"
  | "tsx"
  | "mjs"
  | "cjs"
  | "vue"
  | "svelte"
  | "astro"
  | "json"
  | "yaml"
  | "yml"
  | "mdx";

export type ContentState =
  | "available"
  | "skipped-too-large"
  | "skipped-binary"
  | "unreadable";

export type FileFlag =
  | "symlink"
  | "hidden"
  | "outside-package-root"
  | "secondary-locator";
