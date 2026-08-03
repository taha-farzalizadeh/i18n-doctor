/**
 * Length-preserving blanking so regex / scanner offsets stay valid
 * relative to the original source.
 *
 * IMPORTANT: never apply JS `//` line-comment stripping to HTML/markup —
 * it destroys URLs like `https://example.com`.
 */

function blankMatch(match: string): string {
  return " ".repeat(match.length);
}

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT_RE = /\/\/[^\n]*/g;

/** Blank HTML comments only (safe for Vue/Angular/Svelte/Astro markup). */
export function stripHtmlComments(text: string): string {
  return text.replace(HTML_COMMENT_RE, blankMatch);
}

/** Blank JS/TS block + line comments (script / frontmatter only). */
export function stripJsComments(text: string): string {
  return text
    .replace(BLOCK_COMMENT_RE, blankMatch)
    .replace(LINE_COMMENT_RE, blankMatch);
}

/** Markup-safe noise removal (HTML comments only). */
export function stripMarkupNoise(text: string): string {
  return stripHtmlComments(text);
}

/**
 * Blank matching tag bodies length-preservingly (e.g. `<style>...</style>`).
 */
export function blankTagBodies(
  source: string,
  tagName: string,
): string {
  const re = new RegExp(
    `<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`,
    "gi",
  );
  return source.replace(re, blankMatch);
}

/**
 * Split a mixed file into script-like regions (blanked outside) for JS comment
 * stripping without touching markup URLs.
 */
export function stripJsCommentsInTagBodies(
  source: string,
  tagName: string,
): string {
  const re = new RegExp(
    `(<${tagName}\\b[^>]*>)([\\s\\S]*?)(<\\/${tagName}>)`,
    "gi",
  );
  return source.replace(re, (_full, open: string, body: string, close: string) => {
    return `${open}${stripJsComments(body)}${close}`;
  });
}
