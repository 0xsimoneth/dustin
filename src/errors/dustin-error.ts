/**
 * The single error type thrown by the Dustin SDK and CLI.
 * The full taxonomy (stage, verdict, remedy) is defined in docs/adr/ADR-0006-error-taxonomy.md.
 */
export class DustinError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DustinError";
    this.code = code;
  }
}

export function notImplemented(what: string): DustinError {
  return new DustinError("NOT_IMPLEMENTED", `${what} is not implemented yet`);
}
