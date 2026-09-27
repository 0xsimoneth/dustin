import { describe, expect, it, vi } from "vitest";
import { mergePreflight } from "../../../src/execute/preflight.js";
import { planClose } from "../../../src/plan/plan-close.js";
import { horizonJson } from "../../../src/reader/horizon-json.js";
import { horizonReader } from "../../../src/reader/ledger-reader.js";
import { FakeLedger } from "../../helpers/fake-ledger.js";
import { TESTNET_HORIZON } from "../../helpers/recorded-horizon.js";
import { messy } from "../../helpers/snapshots.js";

// Blind review BH11: a guard that is not ok must block the merge even when it names no ledger.
// `sequenceGuard` never returns that combination today, so the test makes it, and only for the
// preflight: the planner keeps the real guard.
const broken = vi.hoisted(() => ({ on: false }));
vi.mock("../../../src/plan/guard.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../src/plan/guard.js")>();
  return {
    ...real,
    sequenceGuard: (input: Parameters<typeof real.sequenceGuard>[0]) => {
      const guard = real.sequenceGuard(input);
      return broken.on ? { ...guard, ok: false, unblocksAtLedger: null, etaSeconds: null } : guard;
    },
  };
});

describe("blind review BH11: the merge preflight fails on any guard that is not ok", () => {
  it("refuses the merge when the guard is not ok and names no ledger", async () => {
    const ledger = FakeLedger.messy();
    const reader = horizonReader(
      horizonJson(TESTNET_HORIZON, { fetch: ledger.fetch, retries: 0, backoffMs: 0 }),
    );
    const plan = await planClose(
      { account: messy.fixture, destination: messy.destination, feeSponsor: messy.sponsor },
      { reader },
    );
    expect(await mergePreflight(reader, plan, { mergeOnly: false })).toMatchObject({ ok: true });

    broken.on = true;
    const result = await mergePreflight(reader, plan, { mergeOnly: false });
    broken.on = false;
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/sequence guard blocks the merge/);
    expect(result).not.toHaveProperty("unblocksAtLedger");
  });
});
