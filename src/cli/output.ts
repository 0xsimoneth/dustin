/**
 * A writer for standard output or standard error that never crashes the process. When the
 * reader goes away (`dustin close ... | head`), Node emits an EPIPE "error" event on the stream,
 * and an unhandled one would kill a close with a transaction in flight; after any stream error
 * the writer stops writing to that stream and the run goes on (the --report file still gets
 * every change).
 */
export function guardedWriter(stream: NodeJS.WritableStream): (text: string) => void {
  let broken = false;
  stream.on("error", () => {
    broken = true;
  });
  return (text) => {
    if (broken) return;
    try {
      stream.write(text);
    } catch {
      broken = true;
    }
  };
}
