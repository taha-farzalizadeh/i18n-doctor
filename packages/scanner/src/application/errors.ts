import type { ScannerErrorClass } from "../domain/errors.js";

/** Operational error thrown for hard-fail conditions (e.g. invalid root). */
export class ScannerOperationError extends Error {
  readonly code: ScannerErrorClass;
  readonly details: Readonly<Record<string, string>> | undefined;

  constructor(
    message: string,
    code: ScannerErrorClass,
    details?: Readonly<Record<string, string>>,
  ) {
    super(message);
    this.name = "ScannerOperationError";
    this.code = code;
    this.details = details;
  }
}

export function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === code
  );
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
