/**
 * Terminal capability detection — color, Unicode, OSC-8 hyperlinks.
 * Conservative on Windows legacy consoles; respects CI / NO_COLOR / FORCE_*.
 */

export interface TerminalCapabilities {
  readonly color: boolean;
  readonly unicode: boolean;
  readonly hyperlinks: boolean;
}

export function detectTerminalCapabilities(options: {
  readonly noColor?: boolean;
  readonly configColor?: boolean;
  readonly stdoutIsTTY?: boolean;
  readonly stderrIsTTY?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
}): TerminalCapabilities {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const stdoutTTY = options.stdoutIsTTY ?? Boolean(process.stdout.isTTY);
  const stderrTTY = options.stderrIsTTY ?? Boolean(process.stderr.isTTY);
  const tty = stdoutTTY || stderrTTY;

  const colorArgs: {
    noColor?: boolean;
    configColor: boolean;
    tty: boolean;
    env: NodeJS.ProcessEnv;
  } = {
    configColor: options.configColor ?? true,
    tty,
    env,
  };
  if (options.noColor) colorArgs.noColor = true;
  const color = resolveColor(colorArgs);

  const unicode = resolveUnicode({ tty, env, platform });
  const hyperlinks = resolveHyperlinks({
    color,
    tty: stdoutTTY,
    env,
    platform,
  });

  return { color, unicode, hyperlinks };
}

function resolveColor(input: {
  noColor?: boolean;
  configColor: boolean;
  tty: boolean;
  env: NodeJS.ProcessEnv;
}): boolean {
  if (input.noColor) return false;
  if (input.env["NO_COLOR"] !== undefined && input.env["NO_COLOR"] !== "") {
    return false;
  }
  if (input.env["FORCE_COLOR"] !== undefined && input.env["FORCE_COLOR"] !== "0") {
    return true;
  }
  if (input.env["CI"]) return false;
  if (!input.configColor) return false;
  return input.tty;
}

function resolveUnicode(input: {
  tty: boolean;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}): boolean {
  if (input.env["I18N_UNUSED_ASCII"] === "1") return false;
  if (input.env["TERM"] === "dumb") return false;
  // Windows: prefer Unicode when VT / modern terminals are present.
  if (input.platform === "win32") {
    if (input.env["WT_SESSION"]) return true;
    if (input.env["TERM_PROGRAM"]) return true;
    if (input.env["ConEmuANSI"] === "ON") return true;
    // Legacy cmd.exe — ASCII glyphs for progress.
    return false;
  }
  return true;
}

function resolveHyperlinks(input: {
  color: boolean;
  tty: boolean;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}): boolean {
  if (!input.color) return false;
  if (!input.tty) return false;
  if (input.env["FORCE_HYPERLINK"] === "0") return false;
  if (input.env["FORCE_HYPERLINK"] === "1") return true;
  if (input.env["CI"]) return false;

  const program = input.env["TERM_PROGRAM"] ?? "";
  if (
    program === "iTerm.app" ||
    program === "Apple_Terminal" ||
    program === "vscode" ||
    program === "ghostty" ||
    program === "WezTerm"
  ) {
    return true;
  }
  if (input.env["WT_SESSION"]) return true; // Windows Terminal
  if (input.env["KITTY_WINDOW_ID"]) return true;
  if (input.env["VTE_VERSION"]) return true;
  if (input.platform === "darwin" && input.tty) return true;
  // Conservative default elsewhere (incl. plain Linux tty / Win32).
  return false;
}
