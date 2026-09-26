import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Architecture section 11: the public-network constant is never referenced in src/.
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

describe("testnet-only source", () => {
  it("never references the public network (constant, passphrase or Horizon host)", () => {
    const offenders = sourceFiles("src").filter((file) => {
      const text = readFileSync(file, "utf8");
      return /\bPUBLIC\b|Public Global Stellar Network|horizon\.stellar\.org/.test(text);
    });
    expect(offenders).toEqual([]);
  });
});
