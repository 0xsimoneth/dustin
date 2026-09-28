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
 * the writer stops writing to that stream and the run goes on. Nothing is dropped silently: with a
 * `fallback` the rest goes there after a one-time notice (the --report file also gets every change).
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
      stream.write(text);
    } catch {
      broken = true;
      elsewhere(text);
    }
  };
}
