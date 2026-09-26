import { Horizon, Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { buildProgram } from "../../src/cli/program.js";
import {
  DustinError,
  executeClose,
  keypairSigner,
  planClose,
  planFromSnapshot,
  type CloseEvent,
  type CloseReport,
  type CloseStatus,
  type ExecuteOptions,
  type LedgerReader,
  type Signer,
  type Signers,
  type StepOutcome,
  type SubmittedTransaction,
  verifyClosed,
} from "../../src/index.js";
import { randomSnapshot } from "../helpers/generate.js";

/** A reader that records every call and must never be reached in these tests. */
function countingReader(): { reader: LedgerReader; calls: string[] } {
  const calls: string[] = [];
  const refuse = (name: string) => () => {
    calls.push(name);
    return Promise.reject(new Error(`unexpected read: ${name}`));
  };
  return {
    calls,
    reader: {
      source: "https://horizon-testnet.stellar.org",
      networkPassphrase: refuse("networkPassphrase"),
      latestLedger: refuse("latestLedger"),
      feeStats: refuse("feeStats"),
      account: refuse("account"),
      offers: refuse("offers"),
      strictSendPathsToNative: refuse("strictSendPathsToNative"),
      claimableBalancesSponsoredBy: refuse("claimableBalancesSponsoredBy"),
      liquidityPoolAssets: refuse("liquidityPoolAssets"),
    },
  };
}

describe("public API", () => {
  it("planClose refuses a malformed account before any request", async () => {
    await expect(planClose({ account: "nope", destination: "nope" })).rejects.toMatchObject({
      name: "DustinError",
      code: "INVALID_ADDRESS",
    });
  });

  it("executeClose refuses to run without confirm: true, before any request or signature", async () => {
    const snapshot = randomSnapshot(7, { offers: 1, trustlines: 1 });
    const plan = planFromSnapshot(snapshot, { destination: snapshot.destination!.account });
    const { reader, calls } = countingReader();
    const signed: string[] = [];
    const signer = (key: string): Signer => ({
      publicKey: () => key,
      sign: () => void signed.push(key),
    });
    const signers: Signers = {
      account: signer(plan.account),
      feeSponsor: signer(Keypair.random().publicKey()),
    };
    const submitted: string[] = [];
    const error: unknown = await executeClose(plan, signers, {
      confirm: false as unknown as true,
      reader,
      submitter: {
        submit: (xdr) => {
          submitted.push(xdr);
          return Promise.resolve({ status: 500, body: null });
        },
        transaction: () => Promise.resolve(null),
      },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DustinError);
    expect(error).toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    expect(calls).toEqual([]);
    expect(signed).toEqual([]);
    expect(submitted).toEqual([]);
  });

  it("exposes the executor, the keypair signer and their types", () => {
    const signer: Signer = keypairSigner(Keypair.random());
    const signers: Signers = { account: signer, feeSponsor: signer };
    const events: CloseEvent[] = [];
    const reports: CloseReport[] = [];
    const options: ExecuteOptions = {
      confirm: true,
      allowPartial: false,
      onEvent: (event) => void events.push(event),
      onReport: (report) => void reports.push(report),
    };
    const status: CloseStatus = "closed";
    const outcome: StepOutcome = { stepId: "cancel_offer:1", status: "not_run", txIndex: 0 };
    const hashOnly: Pick<SubmittedTransaction, "hash" | "explorerUrl"> = {
      hash: "0".repeat(64),
      explorerUrl: "https://stellar.expert/explorer/testnet/tx/0",
    };
    expect(typeof executeClose).toBe("function");
    expect(signers.account.publicKey()).toMatch(/^G[A-Z2-7]{55}$/);
    // The signer keeps its key in a closure: serialising it reveals nothing.
    expect(JSON.stringify(signer)).toBe("{}");
    expect([options.confirm, status, outcome.status, hashOnly.hash.length]).toEqual([
      true,
      "closed",
      "not_run",
      64,
    ]);
  });
});

describe("public API: verifyClosed", () => {
  it("is exported and refuses a malformed account before any request", async () => {
    await expect(verifyClosed("nope")).rejects.toMatchObject({
      name: "DustinError",
      code: "INVALID_ADDRESS",
    });
  });
});

describe("CLI program", () => {
  it("lists the plan and close commands", () => {
    const help = buildProgram("0.0.0", { stdout: () => {}, stderr: () => {} }).helpInformation();
    expect(help).toMatch(/\bplan\b/);
    expect(help).toMatch(/\bclose\b/);
  });
});

describe("unit tier isolation", () => {
  it("refuses network access", async () => {
    await expect(fetch("https://horizon-testnet.stellar.org")).rejects.toThrow(/network access/);
  });

  it("refuses Horizon calls made through the SDK", async () => {
    const server = new Horizon.Server("https://horizon-testnet.stellar.org");
    await expect(server.feeStats()).rejects.toThrow(/network access/);
  });
});
