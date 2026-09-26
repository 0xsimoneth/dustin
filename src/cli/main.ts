#!/usr/bin/env node
import { createRequire } from "node:module";
import { loadDotEnv } from "./env.js";
import { run } from "./run.js";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json") as { version: string };

loadDotEnv();
process.exitCode = await run(
  process.argv,
  { stdout: (text) => process.stdout.write(text), stderr: (text) => process.stderr.write(text) },
  version,
);
