import type { ClosePlan } from "stellar-dustin";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { planInBrowser } from "../src/plan";
import { shortAddress, toView, xlm } from "../src/view";
import { loadRecorded, messyAccounts, recordedFetch } from "./helpers/recorded";

// The plan-to-view mapping on the recorded messy fixture (the SOW's metric account), with the
// network stubbed, and on plans derived from it (a missing account, no destination, a partial).

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
    for (const l of v.links) expect(l.url).toBe(`${EXPLORER}/account/${l.address}`);
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

  it("no destination: the cleanup is listed, the plan is BLOCKED by DESTINATION_MISSING", async () => {
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
    expect(v.steps.length).toBeGreaterThan(0);
    expect(v.steps.some((s) => s.action.startsWith("merge"))).toBe(false);
    expect(v.status.closeNote).toMatch(/^Without --partial, the close refuses to start/);
    expect(view(noDestination, true).status.closeNote).toMatch(/^With --partial/);
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
  });
});

describe("formatting", () => {
  it("prints stroops as XLM with 7 decimals, without floating point", () => {
    expect(xlm(0)).toBe("0.0000000 XLM");
    expect(xlm(625_350)).toBe("0.0625350 XLM");
    expect(xlm(50_000_000)).toBe("5.0000000 XLM");
    expect(xlm(123_456_789_012)).toBe("12345.6789012 XLM");
    expect(xlm(-7)).toBe("-0.0000007 XLM");
  });

  it("shortens an address to its first and last four characters", () => {
    expect(shortAddress(messy.destination)).toBe("GBQG...DH2C");
    expect(shortAddress("short")).toBe("short");
  });
});
