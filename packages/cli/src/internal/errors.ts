/**
 * CLI error types and top-level error handling.
 */

export type CliErrorCode =
  | "USAGE"
  | "CONFIG"
  | "IO"
  | "PERMISSION"
  | "NOT_FOUND"
  | "NOT_IMPLEMENTED"
  | "INTERNAL";

export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly exitCode: number;
  readonly hint?: string;

  constructor(
    code: CliErrorCode,
    message: string,
    options?: {
      readonly exitCode?: number;
      readonly hint?: string;
      readonly cause?: unknown;
    },
  ) {
    super(
      message,
      options?.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = "CliError";
    this.code = code;
    this.exitCode = options?.exitCode ?? defaultExitCode(code);
    if (options?.hint !== undefined) this.hint = options.hint;
  }
}

function defaultExitCode(code: CliErrorCode): number {
  switch (code) {
    case "NOT_IMPLEMENTED":
      return 0;
    case "USAGE":
    case "CONFIG":
    case "IO":
    case "PERMISSION":
    case "NOT_FOUND":
    case "INTERNAL":
      return 2;
  }
}

/** Map Node.js filesystem errors to CliError. */
export function cliErrorFromErrno(
  error: unknown,
  context: string,
): CliError {
  const err = error as NodeJS.ErrnoException;
  const code = err?.code;
  if (code === "ENOENT") {
    return new CliError("NOT_FOUND", `${context}: path not found`, {
      hint: "Check that the path exists and is accessible.",
      cause: error,
    });
  }
  if (code === "EACCES" || code === "EPERM") {
    return new CliError(
      "PERMISSION",
      `${context}: permission denied`,
      {
        hint: "Check file/directory permissions for the current user.",
        cause: error,
      },
    );
  }
  if (code === "ENOTDIR") {
    return new CliError("IO", `${context}: not a directory`, { cause: error });
  }
  const message =
    error instanceof Error ? error.message : String(error);
  return new CliError("IO", `${context}: ${message}`, { cause: error });
}

/**
 * Stable, script-friendly error formatting.
 * Uses ASCII only (no Unicode glyphs) for Windows legacy consoles.
 */
export function formatCliError(error: unknown, verbose = false): string {
  if (error instanceof CliError) {
    const lines = [`error[${error.code}]: ${error.message}`];
    if (error.hint) lines.push(`hint: ${error.hint}`);
    if (verbose && error.cause instanceof Error) {
      lines.push(error.cause.stack ?? error.cause.message);
    }
    return lines.join("\n");
  }
  if (error instanceof Error) {
    return verbose
      ? `error[INTERNAL]: ${error.stack ?? error.message}`
      : `error[INTERNAL]: ${error.message}`;
  }
  return `error[INTERNAL]: ${String(error)}`;
}

export function handleCliError(
  error: unknown,
  options: {
    readonly verbose?: boolean;
    readonly stderr?: NodeJS.WritableStream;
  } = {},
): number {
  const stderr = options.stderr ?? process.stderr;
  stderr.write(`${formatCliError(error, options.verbose)}\n`);
  if (error instanceof CliError) return error.exitCode;
  return 2;
}
