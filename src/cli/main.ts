#!/usr/bin/env node
import { createRequire } from "node:module";
import { terminalPrompt } from "./prompt.js";
import { run } from "./run.js";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json") as { version: string };

// No `.env` is loaded into the process here (review R7): only `dustin close --execute` reads it,
// and it takes nothing from it but DUSTIN_ACCOUNT_SECRET and DUSTIN_SPONSOR_SECRET.
process.exitCode = await run(
  process.argv,
  { stdout: (text) => process.stdout.write(text), stderr: (text) => process.stderr.write(text) },
  version,
  {
    env: process.env,
    cwd: process.cwd(),
    prompt: terminalPrompt({ input: process.stdin, output: process.stderr }),
  },
);
