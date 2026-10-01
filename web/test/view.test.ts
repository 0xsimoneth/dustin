import { Account, MuxedAccount } from "@stellar/stellar-sdk";
import type { ClosePlan } from "stellar-dustin";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { planInBrowser } from "../src/plan";
import { shortAddress, toView, xlm } from "../src/view";
import { loadRecorded, messyAccounts, recordedFetch } from "./helpers/recorded";

// The plan-to-view mapping on the recorded messy fixture (the SOW's metric account), with the
// network stubbed, and on plans derived from it (a missing account, no destination, a partial, a
// blocked plan, a muxed destination, figures that are not numbers).

const EXPLORER = "https://stellar.expert/explorer/testnet";
const recorded = loadRecorded();
const messy = messyAccounts();

let plan: ClosePlan;
beforeAll(async () => {
  vi.stubGlobal("fetch", recordedFetch(recorded).fetch);
  plan = await planInBrowser({
    account: messy.fixture,
    destination: messy.destination,
    sponsor: messy.sponsor,
    allowPartial: false,
    preferDestination: false,
  });
});
afterEach(() => vi.unstubAllGlobals());

const view = (p: ClosePlan, allowPartial = false) =>
  toView(p, { allowPartial, explorerBase: EXPLORER });

describe("toView on the recorded messy fixture", () => {
  it("names the status in words with the CLI's sentence", () => {
    const v = view(plan);
    expect(v.status.word).toBe("CLOSABLE");
    expect(v.status.sentence).toBe("the plan ends in a merge");
    expect(v.status.closeNote).toContain("end in the merge");
  });

  it("carries the balance, the recovery and the reserves released to sponsors", () => {
    const v = view(plan);
    expect(v.balance).toEqual({
      balance: "4.0000000",
      minimum: "4.0000000",
      spendable: "0.0000000",
      baseReserve: "0.5000000",
    });
    expect(v.recovery?.merges).toBe(true);
    expect(v.recovery?.toDestination).toBe("4.0000007 XLM");
    expect(v.recovery?.detail).toBe("balance 4.0000000 + sale 0.0000007");
    expect(v.recovery?.sponsors).toEqual([
      { sponsor: messy.reserveSponsor, xlm: "0.5000000 XLM", entries: ["trustline SPTA"] },
    ]);
  });

  it("states the fee bid, the per-operation bid, the budget and the payer", () => {
    const v = view(plan);
    expect(v.fees).toEqual({
      bid: "0.0625350 XLM",
      perOperation: "41,690 stroops per operation",
      budget: "5.0000000 XLM",
      withinBudget: true,
      payer: messy.sponsor,
    });
  });

  it("lists the 12 steps in order with 1-based transaction numbers and the CLI's action words", () => {
    const v = view(plan);
    expect(v.steps).toHaveLength(12);
    expect(v.steps.map((s) => s.tx)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 3]);
    expect(v.steps[0]).toMatchObject({
      id: "S01",
      action: "cancel offer 826680: sells 0.0000002 DUSTA for XLM",
    });
    expect(v.steps[0]?.why).toMatch(/^Open offer 826680/);
    expect(v.steps.at(-1)?.action).toBe(
      `merge into ${shortAddress(messy.destination)} (cannot be undone)`,
    );
    expect(v.transactions.map((t) => [t.number, t.phase, t.opCount])).toEqual([
      [1, "cleanup", 9],
      [2, "convert", 2],
      [3, "merge", 1],
    ]);
    expect(v.transactions[0]?.bid).toBe("416,900 stroops");
  });

  it("links the account, the destination, the sponsor and each issuer once on the testnet explorer", () => {
    const v = view(plan);
    expect(v.links.map((l) => [l.label, l.address])).toEqual([
      ["Account", messy.fixture],
      ["Destination", messy.destination],
      ["Fee sponsor", messy.sponsor],
      ["Issuer of DUSTA, DUSTB, DUSTC, SPTA", messy.issuer],
    ]);
    for (const l of v.links) {
      expect(l.target).toBe(l.address);
      expect(l.url).toBe(`${EXPLORER}/account/${l.address}`);
    }
    // A trailing slash on the explorer base does not double up.
    const slashed = toView(plan, { allowPartial: false, explorerBase: `${EXPLORER}/` });
    expect(slashed.links[0]?.url).toBe(`${EXPLORER}/account/${messy.fixture}`);
  });

  it("has no blockers, no unclosable items, a sequence guard that is ok, and the plan hash", () => {
    const v = view(plan);
    expect(v.blockers).toEqual([]);
    expect(v.unclosable).toEqual([]);
    expect(v.sequenceGuard).toMatch(/^Sequence guard ok/);
    expect(v.planHash).toBe(plan.planHash);
  });

  it("says that --partial changes nothing for a closable plan", () => {
    expect(view(plan, true).status.closeNote).toMatch(/--partial changes nothing/);
  });
});

describe("toView on derived plans", () => {
  it("a missing account: BLOCKED, no balance, no fees, nothing recovered", async () => {
    vi.stubGlobal("fetch", recordedFetch(recorded, { [`/accounts/${messy.fixture}`]: null }).fetch);
    const missing = await planInBrowser({
      account: messy.fixture,
      destination: messy.destination,
      sponsor: "",
      allowPartial: true,
      preferDestination: false,
    });
    const v = view(missing, true);
    expect(v.status.word).toBe("BLOCKED");
    expect(v.status.closeNote).toBe("Nothing can run: the account does not exist on the ledger.");
    expect(v.balance).toBeNull();
    expect(v.recovery).toBeNull();
    expect(v.fees).toBeNull();
    expect(v.steps).toEqual([]);
    expect(v.blockers.map((b) => b.code)).toEqual(["ACCOUNT_MISSING"]);
    expect(v.sponsor).toBeNull();
    expect(v.links.map((l) => l.label)).toEqual(["Account", "Destination"]);
  });

  it("no destination: the cleanup is listed, the plan is BLOCKED by DESTINATION_MISSING, and the note says the CLI needs --to", async () => {
    vi.stubGlobal("fetch", recordedFetch(recorded).fetch);
    const noDestination = await planInBrowser({
      account: messy.fixture,
      destination: "",
      sponsor: messy.sponsor,
      allowPartial: false,
      preferDestination: false,
    });
    const v = view(noDestination);
    expect(v.status.word).toBe("BLOCKED");
    expect(v.destination).toBeNull();
    expect(v.blockers.map((b) => b.code)).toEqual(["DESTINATION_MISSING"]);
    expect(v.steps).toHaveLength(11);
    expect(v.steps.some((s) => s.action.startsWith("merge"))).toBe(false);
    // Neither note promises that --partial runs anything: without --to the CLI does not start (W1).
    for (const allowPartial of [false, true]) {
      const note = view(noDestination, allowPartial).status.closeNote;
      expect(note).toMatch(/^The CLI needs --to; nothing runs until a destination is given\./);
      expect(note).toMatch(/The 11 steps listed are the cleanup the planner can see without one/);
      expect(note).not.toMatch(/would run|--partial/);
    }
    expect(v.recovery?.merges).toBe(false);
    expect(v.recovery?.detail).toBe("nothing arrives: the plan does not merge");
    expect(v.links.map((l) => l.label)).toEqual([
      "Account",
      "Fee sponsor",
      "Issuer of DUSTA, DUSTB, DUSTC, SPTA",
    ]);
  });

  it("a partial plan: the unclosable item with its rungs, and the two --partial notes", () => {
    const trustline = plan.steps.find((s) => s.subject.type === "trustline")!.subject;
    const partial: ClosePlan = {
      ...plan,
      status: "partial",
      unclosable: [
        {
          code: "TRUSTLINE_NOT_AUTHORIZED",
          subject: trustline,
          reason: "The issuer has not authorized the trustline, so the balance cannot move.",
          remedy: "Ask the issuer to authorize the trustline, then run the plan again.",
          blocksMerge: true,
          rungsRuledOut: [
            { rung: "path_payment", reason: "not authorized" },
            { rung: "return_to_issuer", reason: "not authorized" },
          ],
        },
      ],
    };
    const v = view(partial);
    expect(v.status.word).toBe("PARTIAL");
    expect(v.unclosable).toHaveLength(1);
    expect(v.unclosable[0]).toMatchObject({
      code: "TRUSTLINE_NOT_AUTHORIZED",
      rungs: [
        { rung: "path payment", reason: "not authorized" },
        { rung: "return to issuer", reason: "not authorized" },
      ],
    });
    expect(v.unclosable[0]?.subject).toMatch(/DUST|SPTA/);
    expect(v.status.closeNote).toMatch(/^Without --partial, the close refuses to start/);
    expect(view(partial, true).status.closeNote).toMatch(
      /^With --partial, the close would run the 12 steps listed and stop before the merge/,
    );
    expect(v.recovery?.merges).toBe(false);
  });

  it("a blocked plan with a blocker --partial cannot clear: neither note promises a step (W1)", () => {
    const blocked: ClosePlan = {
      ...plan,
      status: "blocked",
      blockers: [
        {
          code: "SEQNUM_TOO_FAR",
          permanent: false,
          reason: "The account's sequence number is too far ahead of the ledger for a merge.",
          remedy: "Wait until the ledger catches up, then plan again.",
        },
      ],
    };
    const without = view(blocked).status.closeNote;
    const withPartial = view(blocked, true).status.closeNote;
    expect(without).toMatch(
      /^Without --partial, the close refuses to start while the blockers below hold \(exit code 3\)\./,
    );
    expect(without).toMatch(/--partial does not clear a blocker/);
    expect(withPartial).toMatch(
      /^With --partial, the close may go on without the merge, which the blockers below still block/,
    );
    for (const note of [without, withPartial]) {
      expect(note).not.toMatch(/would run/);
      expect(note).toMatch(/at most the 12 steps listed/);
      expect(note).toMatch(/stay open \(exit code 4\)/);
    }
    expect(view(blocked).recovery?.merges).toBe(false);
    // With no step at all, nothing can run.
    expect(view({ ...blocked, steps: [], transactions: [] }).status.closeNote).toMatch(
      /^Nothing can run today: the blockers below hold/,
    );
  });

  it("a muxed destination links its base account and stays text itself; an invalid address is text only (W3)", () => {
    const muxed = new MuxedAccount(new Account(messy.destination, "0"), "7").accountId();
    const destination = view({ ...plan, destination: muxed }).links.find(
      (l) => l.label === "Destination",
    );
    expect(destination).toEqual({
      label: "Destination",
      address: muxed,
      url: `${EXPLORER}/account/${messy.destination}`,
      target: messy.destination,
    });
    const shaped = `M${"A".repeat(68)}`;
    const odd = view({ ...plan, destination: shaped, feeSponsor: "not an address" });
    expect(odd.links.find((l) => l.label === "Destination")).toEqual({
      label: "Destination",
      address: shaped,
      url: null,
      target: null,
    });
    expect(odd.links.find((l) => l.label === "Fee sponsor")).toEqual({
      label: "Fee sponsor",
      address: "not an address",
      url: null,
      target: null,
    });
  });

  it("prints a figure that is not a finite number as unknown (W3)", () => {
    const odd: ClosePlan = {
      ...plan,
      observed: { ...plan.observed, ledger: Number.NaN },
      fees: { ...plan.fees, totalStroops: Number.POSITIVE_INFINITY, baseFeeStroops: Number.NaN },
    };
    const v = view(odd);
    expect(v.observed.ledger).toBe("unknown");
    expect(v.fees?.bid).toBe("unknown");
    expect(v.fees?.perOperation).toBe("unknown stroops per operation");
    expect(v.fees?.budget).toBe("5.0000000 XLM");
  });
});

describe("formatting", () => {
  it("prints stroops as XLM with 7 decimals, without floating point", () => {
    expect(xlm(0)).toBe("0.0000000 XLM");
    expect(xlm(625_350)).toBe("0.0625350 XLM");
    expect(xlm(50_000_000)).toBe("5.0000000 XLM");
    expect(xlm(123_456_789_012)).toBe("12345.6789012 XLM");
    expect(xlm(-7)).toBe("-0.0000007 XLM");
    expect(xlm(Number.NaN)).toBe("unknown");
    expect(xlm(Number.NEGATIVE_INFINITY)).toBe("unknown");
  });

  it("shortens an address to its first and last four characters", () => {
    expect(shortAddress(messy.destination)).toBe("GBQG...DH2C");
    expect(shortAddress("short")).toBe("short");
  });
});
