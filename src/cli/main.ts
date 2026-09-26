#!/usr/bin/env node
import { createRequire } from "node:module";
import { DustinError } from "../errors/dustin-error.js";
import { buildProgram } from "./program.js";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json") as { version: string };

try {
  await buildProgram(version).parseAsync(process.argv);
} catch (error) {
  const message = error instanceof DustinError ? `${error.code}: ${error.message}` : String(error);
  process.stderr.write(`dustin: ${message}\n`);
  process.exitCode = 1;
}
