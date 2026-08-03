/**
 * Minimal glob matcher for include/workspace patterns.
 * Supports `*`, `?`, `**`, and trailing `/` (directory-only).
 */

export interface CompiledGlob {
  readonly pattern: string;
  readonly directoryOnly: boolean;
  test(path: string, isDirectory: boolean): boolean;
}

export function compileGlob(pattern: string): CompiledGlob {
  const trimmed = pattern.trim();
  const directoryOnly = trimmed.endsWith("/");
  const body = directoryOnly ? trimmed.slice(0, -1) : trimmed;
  const regex = globToRegExp(body);

  return {
    pattern: trimmed,
    directoryOnly,
    test(path: string, isDirectory: boolean): boolean {
      if (directoryOnly && !isDirectory) {
        return false;
      }
      return regex.test(path);
    },
  };
}

export function matchesAnyGlob(
  path: string,
  isDirectory: boolean,
  globs: readonly CompiledGlob[],
): boolean {
  if (globs.length === 0) {
    return true;
  }
  for (const glob of globs) {
    if (glob.test(path, isDirectory)) {
      return true;
    }
    // Directory prefix match: include `src/**/*.ts` should not prune `src`
    if (isDirectory && matchesPrefixForDescent(path, glob.pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a directory should be entered because some include pattern
 * could match a descendant.
 */
export function matchesPrefixForDescent(dirPath: string, pattern: string): boolean {
  const body = pattern.endsWith("/") ? pattern.slice(0, -1) : pattern;
  if (body.startsWith("**/") || body === "**" || body.startsWith("**")) {
    return true;
  }

  const patternParts = body.split("/");
  const dirParts = dirPath === "" ? [] : dirPath.split("/");

  for (let i = 0; i < dirParts.length; i += 1) {
    const patternPart = patternParts[i];
    const dirPart = dirParts[i];
    if (patternPart === undefined) {
      // Pattern ended but directory is deeper — only OK if last pattern was **
      return patternParts[patternParts.length - 1] === "**";
    }
    if (patternPart === "**") {
      return true;
    }
    if (!segmentMatch(patternPart, dirPart ?? "")) {
      return false;
    }
  }
  return true;
}

function segmentMatch(patternSegment: string, value: string): boolean {
  if (patternSegment === "**") {
    return true;
  }
  const re = new RegExp(`^${segmentToRegExp(patternSegment)}$`);
  return re.test(value);
}

function globToRegExp(glob: string): RegExp {
  if (glob === "**") {
    return /^.*$/;
  }

  let source = "^";
  const parts = glob.split("/");
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i] ?? "";
    if (part === "**") {
      if (i === parts.length - 1) {
        source += ".*";
      } else {
        source += "(?:.*/)?";
      }
      continue;
    }
    if (i > 0 && parts[i - 1] !== "**") {
      source += "/";
    } else if (i > 0 && parts[i - 1] === "**") {
      // `(?:.*/)?` already consumed optional slash
    } else if (i > 0) {
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
