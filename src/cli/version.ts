import { createRequire } from "node:module";

/**
 * The version of the installed package, from its package.json. The path is the same from the
 * source (src/cli/) and from the build (dist/cli/main.js, into which tsup bundles this module), two
 * directories below the package root. `dustin --version` prints it (AC-E4-S1-3).
 */
export function packageVersion(): string {
  const require = createRequire(import.meta.url);
  return (require("../../package.json") as { version: string }).version;
}
