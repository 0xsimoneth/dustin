import { DustinError } from "../errors/dustin-error.js";
import { redact, redactValue } from "../errors/redact.js";
import { remedyOf } from "../errors/remedies.js";
import type { CloseEvent } from "../execute/events.js";

/**
 * How the CLI writes (story E4-S1): for people, or with `--json` for machines, and with
 * `--verbose` the full detail of an error (AC-E4-S2-2).
 */
export interface OutputMode {
  /**
   * Machine mode (review finding AA-10; docs/ux-design.md section 2.8; PRD FR-19): standard output
   * carries exactly one JSON document, and standard error carries NDJSON only, one JSON object per
   * line with a `type`, never human text. `plan` and `close` only; the fixture commands keep their
   * own output.
   */
  json: boolean;
  /** The full detail of an error: cause chain, Horizon result codes, details (AC-E4-S2-2). */
  verbose: boolean;
}

/** The two streams, as `run()` gets them. */
export interface CliStreams {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/**
 * One line of standard error in machine mode. `type` names it: the executor's CloseEvent types
 * with their fields (`plan` in a compact form), and the CLI's own `notice` and `error` lines.
 */
export type NdjsonLine = { type: string } & Record<string, unknown>;

/**
 * An error or a stop as the CLI reports it: the code integrators branch on, one sentence, what to
 * do, and the exit code it ends the command with.
 */
export interface Failure {
  code: string;
  message: string;
  remedy: string | null;
  exitCode: number;
}

/** Codes of the CLI's own `error` lines, never thrown by the SDK (docs/errors.md). */
export const USAGE_ERROR = "USAGE_ERROR";
export const UNEXPECTED_ERROR = "UNEXPECTED_ERROR";

export interface Channel {
  readonly mode: OutputMode;
  /** Human text on standard output; nothing in machine mode. Redacted. */
  say(text: string): void;
  /**
   * A note for the user on standard error: `dustin: <message>`, or a `notice` line. Each `keep`
   * string (a file path the message names) is never broken or collapsed when the note is wrapped.
   */
  notice(message: string, keep?: readonly string[]): void;
  /** A progress event of the executor: a line in machine mode, nothing for people. */
  event(event: CloseEvent): void;
  /** The error or the stop the command ends with, on standard error; `keep` as for `notice`. */
  fail(failure: Failure, extra?: Record<string, unknown>, keep?: readonly string[]): void;
  /** An error as caught, reported with its code and remedy, and its detail with --verbose. */
  error(error: unknown, exitCode: number): void;
}

/**
 * The writer of every line the `plan` and `close` commands print (review finding AA-10). Every
 * line passes through `redact()`, and in machine mode through `redactValue()` before
 * `JSON.stringify`, which escapes line breaks, so each object is one line (NDJSON).
 */
export function channel(streams: CliStreams, mode: OutputMode): Channel {
  const line = (value: NdjsonLine) => streams.stderr(`${JSON.stringify(redactValue(value))}\n`);
  return {
    mode,
    say: (text) => {
      if (!mode.json) streams.stdout(redact(text));
    },
    notice: (message, keep = []) => {
      if (mode.json) line({ type: "notice", message });
      else streams.stderr(redact(wrapped(`dustin: ${message}`, 2, keep)));
    },
    event: (event) => {
      if (mode.json) line(eventLine(event));
    },
    fail: (failure, extra = {}, keep = []) => {
      if (mode.json) {
        line({ type: "error", ...failure, ...extra });
        return;
      }
      // An unexpected error's message says so itself; a code of Dustin's comes first.
      const head =
        failure.code === UNEXPECTED_ERROR ? failure.message : `${failure.code}: ${failure.message}`;
      streams.stderr(
        redact(wrapped(`dustin: ${head}`, 2, keep)) +
          (failure.remedy ? redact(wrapped(`  ${failure.remedy}`, 2, keep)) : ""),
      );
    },
    error(error, exitCode) {
      const failure = failureOf(error, exitCode);
      if (mode.json) {
        this.fail(failure, mode.verbose ? errorDetail(error) : {});
        return;
      }
      this.fail(failure, {}, verbatimOf(error));
      if (mode.verbose) streams.stderr(redact(verboseText(error)));
    },
  };
}

/** The widest line for people: the demo terminal's 120 columns (docs/ux-design.md section 4). */
const WIDTH = 120;

/**
 * `text` wrapped at 120 columns, each line ending in a line break. The text's own line breaks are
 * kept (Epic 4 review EX-8, BH-21): every line after the first, a wrapped one or one of the text's
 * own, is indented by `indent` spaces, and a line of the text keeps its own leading spaces after
 * them. Lines break only at spaces, and a run of spaces between words is printed as one. A word
 * longer than a line (a URL, a hash) is never split, and neither is any occurrence of a `keep`
 * string, such as a file path, whose spaces are printed exactly as they are.
 */
export function wrapped(text: string, indent: number, keep: readonly string[] = []): string {
  const lines: string[] = [];
  text.split("\n").forEach((paragraph, index) => {
    const own = /^ */.exec(paragraph)![0];
    const next = " ".repeat(indent) + (index === 0 ? "" : own);
    let line = index === 0 ? own : next;
    for (const word of wordsOf(paragraph.slice(own.length), keep)) {
      if (line.trim() !== "" && line.length + 1 + word.length > WIDTH) {
        lines.push(line);
        line = next + word;
      } else {
        line = line.trim() === "" ? line + word : `${line} ${word}`;
      }
    }
    lines.push(index > 0 && line.trim() === "" ? "" : line);
  });
  return `${lines.join("\n")}\n`;
}

/**
 * The words of one line: runs of characters between whitespace, where whitespace inside an
 * occurrence of a `keep` string belongs to the word (a path with spaces stays one word).
 */
function wordsOf(text: string, keep: readonly string[]): string[] {
  const kept = new Array<boolean>(text.length).fill(false);
  for (const k of keep) {
    if (k === "") continue;
    for (let at = text.indexOf(k); at >= 0; at = text.indexOf(k, at + k.length)) {
      kept.fill(true, at, at + k.length);
    }
  }
  const words: string[] = [];
  let word = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (!kept[i] && /\s/.test(c)) {
      if (word !== "") words.push(word);
      word = "";
    } else {
      word += c;
    }
  }
  if (word !== "") words.push(word);
  return words;
}

/**
 * An executor event as an NDJSON line: every event keeps its type and fields (PRD section 7,
 * `CloseEvent`), except `plan`, which carries the plan's hash, round, status and counts rather
 * than the whole plan; the whole plan is the stdout document when a run is refused, and the
 * report names each round's hash.
 */
export function eventLine(event: CloseEvent): NdjsonLine {
  if (event.type !== "plan") return { ...event };
  const p = event.plan;
  return {
    type: "plan",
    ...(event.round !== undefined ? { round: event.round } : {}),
    planHash: p.planHash,
    status: p.status,
    counts: {
      steps: p.steps.length,
      transactions: p.transactions.length,
      unclosable: p.unclosable.length,
      blockers: p.blockers.length,
    },
  };
}

/**
 * What an error's message must print exactly as it is (Epic 4 review EX-8): the text values of a
 * DustinError's `details`, which name what the message refers to, such as the `path` of a report
 * file that cannot be written.
 */
function verbatimOf(error: unknown): string[] {
  if (!(error instanceof DustinError) || !error.details) return [];
  return Object.values(error.details).filter((v): v is string => typeof v === "string");
}

/** Text of anything thrown, without ever throwing itself (a value may lack a usable toString). */
export function textOf(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  try {
    return String(value);
  } catch {
    try {
      return JSON.stringify(value) ?? "a value that has no text";
    } catch {
      return "a value that has no text";
    }
  }
}

/** The code, message and remedy of a caught error; a non-DustinError is UNEXPECTED_ERROR. */
export function failureOf(error: unknown, exitCode: number): Failure {
  if (error instanceof DustinError) {
    // Every error is printed with a remedy: its own, else its code's (AC-E4-S2-1, docs/errors.md).
    return { code: error.code, message: error.message, remedy: remedyOf(error), exitCode };
  }
  return {
    code: UNEXPECTED_ERROR,
    message: `unexpected error: ${redact(textOf(error))}`,
    remedy:
      "This is a bug in Dustin. Run the same command with --verbose and report the output; if a transaction was submitted, its hash is above.",
    exitCode,
  };
}

/**
 * The detail of an error for --verbose (AC-E4-S2-2): the stage, the verdict, whether it may be
 * retried, the details and Horizon's result codes of a DustinError, the cause chain (each cause
 * with its code when it has one) and, for an unexpected error, its stack. Secrets are redacted.
 */
export function errorDetail(error: unknown): Record<string, unknown> {
  const detail: Record<string, unknown> = {};
  if (error instanceof DustinError) {
    detail.stage = error.stage;
    detail.verdict = error.verdict;
    detail.retryable = error.retryable;
    if (error.details) detail.details = error.details;
    if (error.horizon) detail.horizon = error.horizon;
  } else if (error instanceof Error && error.stack) {
    detail.stack = error.stack;
  }
  const causes: Array<Record<string, unknown>> = [];
  const seen = new Set<unknown>([error]);
  let cause: unknown = error instanceof Error ? error.cause : undefined;
  while (cause !== undefined && !seen.has(cause) && causes.length < 10) {
    seen.add(cause);
    causes.push(
      cause instanceof DustinError
        ? { name: cause.name, code: cause.code, message: cause.message, stage: cause.stage }
        : cause instanceof Error
          ? { name: cause.name, message: cause.message }
          : { message: textOf(cause) },
    );
    cause = cause instanceof Error ? cause.cause : undefined;
  }
  if (causes.length > 0) detail.causes = causes;
  return redactValue(detail);
}

/** The --verbose detail as indented text under the one-line error (AC-E4-S2-2). */
function verboseText(error: unknown): string {
  const d = errorDetail(error);
  const lines: string[] = [];
  if (d.stage !== undefined) {
    lines.push(
      `  stage ${textOf(d.stage)}, next: ${textOf(d.verdict)}, retryable ${textOf(d.retryable)}`,
    );
  }
  const horizon = d.horizon as Record<string, unknown> | undefined;
  if (horizon) {
    const parts = Object.entries(horizon).map(
      ([key, value]) => `${key} ${Array.isArray(value) ? value.join(", ") : textOf(value)}`,
    );
    lines.push(`  horizon: ${parts.join("; ")}`);
  }
  const details = d.details as Record<string, unknown> | undefined;
  if (details) {
    for (const [key, value] of Object.entries(details)) lines.push(`  ${key}: ${textOf(value)}`);
  }
  for (const c of (d.causes as Array<Record<string, unknown>> | undefined) ?? []) {
    const code = c.code !== undefined ? `${textOf(c.code)}: ` : "";
    lines.push(`  caused by ${textOf(c.name ?? "a value")}: ${code}${textOf(c.message)}`);
  }
  if (typeof d.stack === "string") {
    lines.push(...d.stack.split("\n").map((l) => `  ${l.trim()}`));
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}
