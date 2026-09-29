/** The notice written once when standard output fails and its text goes to standard error. */
export const STDOUT_CLOSED =
  "standard output was closed; the rest of the output goes to standard error.";

/**
 * Where standard output's text goes once standard output has failed (EPIPE, `| head`), for
 * `guardedWriter`. For people it is standard error as it is, after `dustin: <STDOUT_CLOSED>`.
 * In machine mode standard error carries NDJSON only (Epic 4 review EX-4, AC-13), so the notice
 * becomes a `notice` line and the one JSON document of standard output one `document` line,
 * `{"type":"document","document":{...}}`, the document itself on one line; any other text meant
 * for standard output (Commander's help) becomes a `notice` line too.
 */
export function stdoutFallback(
  stderr: (text: string) => void,
  json: boolean,
): Required<GuardedWriterOptions> {
  if (!json) return { fallback: stderr, notice: `dustin: ${STDOUT_CLOSED}\n` };
  return {
    notice: STDOUT_CLOSED,
    fallback: (text) => {
      let line: { type: string } & Record<string, unknown>;
      try {
        line = { type: "document", document: JSON.parse(text) as unknown };
      } catch {
        line = { type: "notice", message: text.trimEnd() };
      }
      stderr(`${JSON.stringify(line)}\n`);
    },
  };
}

export interface GuardedWriterOptions {
  /**
   * Where the text goes once the stream has failed, with `notice` written there first, once. The
   * CLI sends standard output there to standard error, so a close whose output was piped into
   * `head` still shows every later hash, the receipt and the final report somewhere.
   */
  fallback?: (text: string) => void;
  notice?: string;
}

/**
 * A writer for standard output or standard error that never crashes the process. When the
 * reader goes away (`dustin close ... | head`), Node emits an EPIPE "error" event on the stream,
 * and an unhandled one would kill a close with a transaction in flight; after any stream error
 * the writer stops writing to that stream and the run goes on. With a `fallback`, nothing is
 * dropped silently: the rest goes there after a one-time notice (the CLI gives standard output
 * standard error as its fallback). Without one, as for standard error itself, the rest is dropped.
 * A `--report` file, when one was given, does not depend on either stream and gets every copy of
 * the report (review round 3, R3-29).
 *
 * On a pipe, `write()` does not throw on EPIPE: the chunk is discarded and the failure arrives
 * later, through the write's callback (EPIPE for the chunk that hit the broken pipe, then an error
 * for each chunk queued behind it) and then the "error" event. So every write carries a callback,
 * and each chunk whose callback reports an error goes to the fallback, in the order written and
 * after the notice: the chunk that hit the broken pipe and those written in the same tick are not
 * lost, even when no later write comes (closing review CC-1).
 */
export function guardedWriter(
  stream: NodeJS.WritableStream,
  options: GuardedWriterOptions = {},
): (text: string) => void {
  let broken = false;
  let noticed = false;
  stream.on("error", () => {
    broken = true;
  });
  const elsewhere = (text: string) => {
    if (!options.fallback) return;
    if (!noticed && options.notice) options.fallback(options.notice);
    noticed = true;
    options.fallback(text);
  };
  return (text) => {
    if (broken) return elsewhere(text);
    try {
      stream.write(text, (error) => {
        if (!error) return;
        broken = true;
        elsewhere(text);
      });
    } catch {
      broken = true;
      elsewhere(text);
    }
  };
}

/**
 * The forced exit after a second signal (Epic 4 review EX-3, BH-3): `exit(code)` once standard
 * output and standard error have written everything queued, the one --json document included, or
 * after `boundMs` at the latest. On a pipe their writes are asynchronous outside Windows and Linux
 * (https://nodejs.org/api/process.html#a-note-on-process-io), and `process.exit()` drops what is
 * still queued: observed on macOS, where a document of 5 MB was cut at 64 KB. A second call (a
 * third signal) exits at once.
 */
export function exitAfterFlush(
  streams: readonly NodeJS.WritableStream[],
  exit: (code: number) => void,
  boundMs = 2000,
): (code: number) => void {
  let asked = false;
  let ended = false;
  const end = (code: number) => {
    if (ended) return;
    ended = true;
    exit(code);
  };
  return (code) => {
    if (asked) return end(code);
    asked = true;
    let pending = streams.length;
    const flushed = () => {
      pending -= 1;
      if (pending === 0) end(code);
    };
    for (const stream of streams) {
      try {
        // An empty write's callback runs once everything written before it was handed over.
        stream.write("", () => flushed());
      } catch {
        flushed();
      }
    }
    if (streams.length === 0) end(code);
    setTimeout(() => end(code), boundMs).unref();
  };
}
