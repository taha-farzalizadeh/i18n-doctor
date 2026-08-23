/**
 * Leveled logging for the language server.
 *
 * stdout belongs to the LSP transport, so nothing is ever written there.
 * Output goes to stderr by default, or to the LSP `window/logMessage` channel
 * when a connection sink is attached.
 */

import type { LanguageServerLogLevel } from "@i18n-doctor/config";

export type LogLevel = LanguageServerLogLevel;

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

/** Destination for formatted log lines. */
export interface LogSink {
  write(level: Exclude<LogLevel, "silent">, message: string): void;
}

export interface Logger {
  error(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
  info(message: string, detail?: unknown): void;
  debug(message: string, detail?: unknown): void;
  /** Log a caught value without ever rethrowing. */
  exception(context: string, error: unknown): void;
  setLevel(level: LogLevel): void;
  getLevel(): LogLevel;
  /** Child logger that prefixes every message with `[scope]`. */
  child(scope: string): Logger;
}

export function createStderrSink(
  stream: NodeJS.WritableStream = process.stderr,
): LogSink {
  return {
    write(level, message) {
      try {
        stream.write(`[i18n-doctor][${level}] ${message}\n`);
      } catch {
        // A broken log stream must never take the server down.
      }
    },
  };
}

/** Discards everything. Useful for tests and `logLevel: "silent"`. */
export function createNullSink(): LogSink {
  return { write: () => undefined };
}

export function createLogger(options?: {
  readonly level?: LogLevel;
  readonly sink?: LogSink;
  readonly scope?: string;
}): Logger {
  const state = {
    level: options?.level ?? "error",
    sink: options?.sink ?? createStderrSink(),
  };
  return buildLogger(state, options?.scope);
}

interface LoggerState {
  level: LogLevel;
  sink: LogSink;
}

function buildLogger(state: LoggerState, scope?: string): Logger {
  const prefix = scope ? `[${scope}] ` : "";

  const emit = (
    level: Exclude<LogLevel, "silent">,
    message: string,
    detail?: unknown,
  ): void => {
    if (LEVEL_RANK[state.level] < LEVEL_RANK[level]) return;
    const suffix = detail === undefined ? "" : ` ${formatDetail(detail)}`;
    try {
      state.sink.write(level, `${prefix}${message}${suffix}`);
    } catch {
      // A failing log sink must never take the server down.
    }
  };

  return {
    error: (message, detail) => emit("error", message, detail),
    warn: (message, detail) => emit("warn", message, detail),
    info: (message, detail) => emit("info", message, detail),
    debug: (message, detail) => emit("debug", message, detail),
    exception: (context, error) => {
      emit("error", `${context}: ${describeError(error)}`);
      if (error instanceof Error && error.stack) {
        emit("debug", error.stack);
      }
    },
    setLevel: (level) => {
      state.level = level;
    },
    getLevel: () => state.level,
    child: (childScope) =>
      buildLogger(state, scope ? `${scope}:${childScope}` : childScope),
  };
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  return formatDetail(error) || "unknown error";
}

function formatDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  try {
    // `JSON.stringify` returns undefined for undefined/functions/symbols.
    return JSON.stringify(detail) ?? String(detail);
  } catch {
    return String(detail);
  }
}
