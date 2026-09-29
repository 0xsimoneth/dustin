#!/usr/bin/env node
import { exitAfterFlush, guardedWriter, stdoutFallback } from "./output.js";
import { hiddenPrompt, terminalPrompt } from "./prompt.js";
import { run, scanMode } from "./run.js";
import { packageVersion } from "./version.js";

const version = packageVersion();

// No `.env` is loaded into the process here (review R7): only `dustin close --execute` reads it,
// and it takes nothing from it but DUSTIN_ACCOUNT_SECRET and DUSTIN_SPONSOR_SECRET.
// If standard output is closed early (`dustin close ... | head`), the rest of it goes to standard
// error after a notice, so no hash, receipt or report is lost without a trace; with --json as
// NDJSON lines, the document as a `document` line (Epic 4 review EX-4, AC-13).
const stderr = guardedWriter(process.stderr);
const stdout = guardedWriter(process.stdout, stdoutFallback(stderr, scanMode(process.argv).json));
process.exitCode = await run(process.argv, { stdout, stderr }, version, {
  env: process.env,
  cwd: process.cwd(),
  // The question goes to standard error; it is asked only when every stream it depends on is a
  // terminal, standard output included when the plan it confirms was printed there.
  prompt: terminalPrompt({ input: process.stdin, output: process.stderr, stdout: process.stdout }),
  // Review finding CA-18: a secret missing from the environment and .env is asked for, hidden, on
  // a terminal; the question goes to standard error.
  secretPrompt: hiddenPrompt({ input: process.stdin, output: process.stderr }),
  // Review finding CL-1: SIGINT and SIGTERM while `close --execute` runs stop it at the next safe
  // point; a second one exits at once (https://nodejs.org/api/process.html#signal-events), once
  // both streams have written what they hold (Epic 4 review EX-3).
  signals: process,
  exit: exitAfterFlush([process.stdout, process.stderr], (code) => process.exit(code)),
});
