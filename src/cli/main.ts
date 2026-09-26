#!/usr/bin/env node
import { createRequire } from "node:module";
import { loadDotEnv } from "./env.js";
import { ExitCode } from "./exit-codes.js";
import { run } from "./run.js";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json") as { version: string };

try {
  loadDotEnv();
  process.exitCode = await run(
    process.argv,
    { stdout: (text) => process.stdout.write(text), stderr: (text) => process.stderr.write(text) },
    version,
    { env: process.env },
  );
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code ?? "unknown error";
  process.stderr.write(`dustin: CONFIG_INVALID: cannot read .env (${code}).\n`);
  process.exitCode = ExitCode.USAGE;
}
