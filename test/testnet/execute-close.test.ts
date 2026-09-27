import { Keypair } from "@stellar/stellar-sdk";
import { expect, it } from "vitest";
import { toStroops } from "../../src/amounts.js";
import { DEFAULT_HORIZON_URL } from "../../src/config/network.js";
import { executeClose } from "../../src/execute/executor.js";
import { buildMessyFixture } from "../../src/fixture/builder.js";
import {
  expectationFromManifest,
  loadVerifyInput,
  verifyFixture,
} from "../../src/fixture/verify.js";
import type { HorizonAccount } from "../../src/inspect/horizon-types.js";
import { planClose } from "../../src/plan/plan-close.js";
import { horizonJson, latestLedger } from "../../src/reader/horizon-json.js";
import { keypairSigner } from "../../src/sponsor/signer.js";
import { writeCloseEvidence, type AccountState } from "../helpers/evidence.js";
import { describeTestnet } from "./gate.js";

/**
 * With DUSTIN_EVIDENCE=1 the run also writes evidence/runs/<UTC stamp>/ (review finding R16):
 * DUSTIN_TESTNET=1 DUSTIN_EVIDENCE=1 npm run test:testnet -- test/testnet/execute-close.test.ts
 * Off by default, so ordinary testnet runs leave the working tree clean.
 */
const writeEvidence = process.env.DUSTIN_EVIDENCE === "1";

describeTestnet("executeClose (live testnet)", () => {
  it("closes a fresh zero-spendable messy fixture with every fee paid by the sponsor", async () => {
    const { manifest, keys } = await buildMessyFixture();
    const a = manifest.accounts;
    const client = horizonJson(DEFAULT_HORIZON_URL);
    const state = async (id: string): Promise<AccountState | null> => {
      const account = await client.get<HorizonAccount>(`/accounts/${id}`);
      if (!account) return null;
      const native = account.balances.find((b) => b.asset_type === "native")!;
      return { balance: native.balance, numSponsoring: account.num_sponsoring };
    };
    const roles = [
      ["Destination", a.destination],
      ["Reserve sponsor", a.reserveSponsor],
      ["Fee sponsor", a.sponsor],
    ] as const;
    const before = await Promise.all(roles.map(([, id]) => state(id)));
    const accountBefore = await client.get<HorizonAccount>(`/accounts/${a.fixture}`);
    // The fixture meets SOW Appendix B right before the close, not only when it was built.
    const verification = verifyFixture(
      await loadVerifyInput(client, expectationFromManifest(manifest), a.fixture),
    );
    expect(verification.checks.filter((c) => !c.pass)).toEqual([]);
    const ledgerBefore = (await latestLedger(client)).sequence;

    const plan = await planClose({
      account: a.fixture,
      destination: a.destination,
      feeSponsor: a.sponsor,
    });
    expect(plan.status).toBe("closable");
    const report = await executeClose(
      plan,
      {
        account: keypairSigner(Keypair.fromSecret(keys.secrets.fixture)),
        feeSponsor: keypairSigner(Keypair.fromSecret(keys.secrets.sponsor)),
      },
      { confirm: true },
    );
    // Everything is collected first and written as evidence before any assertion, so a failed
    // check can never lose the record of a close that already consumed the fixture.
    const gone = await fetch(`${DEFAULT_HORIZON_URL}/accounts/${a.fixture}`, {
      headers: { accept: "application/json" },
    });
    const body: unknown = await gone.json();
    const accountAfter = { status: gone.status, body };
    const records: Array<{
      hash: string;
      record: { fee_account: string; source_account: string; successful: boolean } | null;
    }> = [];
    for (const t of report.transactions) {
      records.push({
        hash: t.hash,
        record: await client.get<{
          fee_account: string;
          source_account: string;
          successful: boolean;
        }>(`/transactions/${t.hash}`),
      });
    }
    const after = await Promise.all(roles.map(([, id]) => state(id)));
    // Secrets in every form a leak could take: StrKey, and the raw 32-byte seed as hex and base64.
    const forbidden = Object.values(keys.secrets).flatMap((secret) => {
      // SDK 17.1.0 returns a Uint8Array here, like hash() and sign() (docs/progress-log.md).
      const raw = Buffer.from(Keypair.fromSecret(secret).rawSecretKey());
      return [secret, raw.toString("hex"), raw.toString("base64")];
    });
    if (writeEvidence) {
      const dir = writeCloseEvidence(
        {
          report,
          manifest,
          verification,
          accountBefore,
          transactions: records,
          accountAfter,
          balances: roles.map(([role, account], i) => ({
            role,
            account,
            before: before[i] ?? null,
            after: after[i] ?? null,
          })),
          ledgers: { before: ledgerBefore, after: (await latestLedger(client)).sequence },
        },
        { root: "evidence/runs", forbidden },
      );
      console.log(`Close evidence written to ${dir}`);
    }

    expect(report.message).toBeNull();
    expect(report.status).toBe("closed");
    expect(report.verification).toMatchObject({ accountExists: false, horizonStatus: 404 });
    expect(accountAfter.status).toBe(404);
    // Every transaction on the ledger is a fee bump paid by the sponsor, sourced by the closed
    // account. The report keeps every submitted envelope (E2-S3): one refused before inclusion or
    // rebuilt after its time bound passed is not on the ledger, so it has no Horizon record.
    report.transactions.forEach((t, i) => {
      const record = records[i]!.record;
      if (t.result === "applied" || t.result === "failed") {
        expect(record).toMatchObject({
          fee_account: a.sponsor,
          source_account: a.fixture,
          successful: t.result === "applied",
        });
      } else {
        expect(record).toBeNull();
      }
    });
    expect(report.transactions.filter((t) => t.result === "applied").length).toBeGreaterThan(0);
    // The destination received exactly the merged amount; the reserve sponsor got its reserve back.
    expect(report.recovery.mergedXlm).not.toBeNull();
    expect(toStroops(after[0]!.balance) - toStroops(before[0]!.balance)).toBe(
      toStroops(report.recovery.mergedXlm!),
    );
    expect(after[1]!.numSponsoring).toBe(0);
    for (const secret of forbidden) expect(JSON.stringify(report)).not.toContain(secret);
  }, 600_000);
});
