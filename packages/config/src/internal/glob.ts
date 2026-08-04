/**
 * Minimal glob matcher (`*`, `?`, `**`).
 * Paths / keys are compared as POSIX-relative strings.
 */

export interface CompileGlobOptions {
  /**
   * When true, patterns without `/` also match against the basename
   * (e.g. `*.stories.tsx` matches `src/Button.stories.tsx`).
   * Disable for keys / locales / namespaces.
   * @default false
   */
  readonly basenameFallback?: boolean;
}

export interface CompiledGlob {
  readonly pattern: string;
  test(value: string): boolean;
}

export function compileGlob(
  pattern: string,
  options?: CompileGlobOptions,
): CompiledGlob {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return { pattern: trimmed, test: () => false };
  }
  const regex = globToRegExp(trimmed);
  const basenameFallback = options?.basenameFallback === true;
  return {
    pattern: trimmed,
    test(value: string): boolean {
      const normalized = toPosixRelative(value);
      if (regex.test(normalized)) return true;
      if (
        basenameFallback &&
        !trimmed.includes("/") &&
        (trimmed.includes("*") || trimmed.includes("?"))
      ) {
        const base = normalized.includes("/")
          ? normalized.slice(normalized.lastIndexOf("/") + 1)
          : normalized;
        return regex.test(base);
      }
      return false;
    },
  };
}

export function matchesAny(
  value: string,
  globs: readonly CompiledGlob[],
): CompiledGlob | undefined {
  for (const g of globs) {
    if (g.test(value)) return g;
  }
  return undefined;
}

function globToRegExp(glob: string): RegExp {
  if (glob === "**" || glob === "**/*") {
    return /^.*$/;
  }

  let source = "^";
  const parts = glob.split("/");
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i] ?? "";
    if (part === "**") {
      if (i === parts.length - 1) {
        // Trailing ** after a segment must consume `/rest` or end — never glue to next chars
        source += i === 0 ? ".*" : "(?:/.*)?";
      } else {
        source += "(?:.*/)?";
      }
      continue;
    }
    if (i > 0 && parts[i - 1] !== "**") {
      source += "/";
    }
    source += segmentToRegExp(part);
  }
  source += "$";
  return new RegExp(source);
}

function segmentToRegExp(segment: string): string {
  let out = "";
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i]!;
    if (ch === "*") {
      out += "[^/]*";
    } else if (ch === "?") {
      out += "[^/]";
    } else if ("+.^${}()|[]\\".includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Normalize path to POSIX relative form (no leading ./). */
export function toPosixRelative(pathLike: string): string {
  return pathLike.replace(/\\/g, "/").replace(/^\.\//, "");
}
