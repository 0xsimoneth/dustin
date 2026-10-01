import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "../../src/canonical-json.js";
import { planClose } from "../../src/plan/plan-close.js";
import { horizonJson } from "../../src/reader/horizon-json.js";
import { horizonReader } from "../../src/reader/ledger-reader.js";
import {
  MESSY_DIR,
  TESTNET_HORIZON,
  loadRecorded,
  recordedFetch,
} from "../helpers/recorded-horizon.js";
import { messy } from "../helpers/snapshots.js";

// Story E5-S1: the SDK entry runs in a browser, so sha256Hex takes its digest from the Stellar
// SDK's hash() (sha256 from @noble/hashes over the UTF-8 bytes) instead of node:crypto. The
// digests must be identical, or every planHash and snapshotHash recorded before the change (the
// committed snapshots, evidence/plan) would change with it.

const nodeSha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe("sha256Hex without node:crypto", () => {
  it("equals Node's sha256 hex for ASCII, multi-byte and astral text, and a long document", () => {
    const samples = [
      "",
      "abc",
      canonicalJson({ b: 1, a: [2, { d: null, c: "x" }], e: "ünï" }),
      "ünïcödé, 日本語, \u{1F600}",
      "\u{1F600}".repeat(1000),
      "x".repeat(200_000),
    ];
    for (const text of samples) expect(sha256Hex(text)).toBe(nodeSha256(text));
  });

  it("prints 64 lower-case hex digits, the known digest of an empty string among them", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the recorded fixture's snapshotHash and planHash of the committed dry-run snapshot", async () => {
    const { fetch } = recordedFetch(loadRecorded(MESSY_DIR));
    const reader = horizonReader(horizonJson(TESTNET_HORIZON, { fetch, retries: 0 }));
    const plan = await planClose(
      { account: messy.fixture, destination: messy.destination, feeSponsor: messy.sponsor },
      { reader },
    );
    // The values of test/unit/plan/__snapshots__/dry-run.test.ts.snap, recorded on 2026-09-26
    // with node:crypto; the fee bid is left out of planHash, so the fee_stats basis does not matter.
    expect(plan.snapshotHash).toBe(
      "3b6ae4120092d2482b31623549112548fd3b50fe47c49a3f5379f92586d362c1",
    );
    expect(plan.planHash).toBe("25be835c88e84af36e96e17fa00fcbf465f6f39a7c6075deab940106eff38c85");
  });
});
