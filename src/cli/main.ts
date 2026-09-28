#!/usr/bin/env node
import { createRequire } from "node:module";
import { guardedWriter } from "./output.js";
import { terminalPrompt } from "./prompt.js";
import { run } from "./run.js";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json") as { version: string };

// No `.env` is loaded into the process here (review R7): only `dustin close --execute` reads it,
// and it takes nothing from it but DUSTIN_ACCOUNT_SECRET and DUSTIN_SPONSOR_SECRET.
// If standard output is closed early (`dustin close ... | head`), the rest of it goes to standard
// error after a notice, so no hash, receipt or report is lost without a trace.
const stderr = guardedWriter(process.stderr);
const stdout = guardedWriter(process.stdout, {
  fallback: stderr,
  notice: "dustin: standard output was closed; the rest of the output goes to standard error.\n",
});
process.exitCode = await run(process.argv, { stdout, stderr }, version, {
  env: process.env,
  cwd: process.cwd(),
  // The question goes to standard error; it is asked only when every stream it depends on is a
  // terminal, standard output included when the plan it confirms was printed there.
  prompt: terminalPrompt({ input: process.stdin, output: process.stderr, stdout: process.stdout }),
  // Review finding CL-1: SIGINT and SIGTERM while the executor runs stop it at the next safe point;
  // a second one exits at once with code 5 (https://nodejs.org/api/process.html#signal-events).
  signals: process,
  exit: (code) => process.exit(code),
});
