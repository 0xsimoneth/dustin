import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CloseReport } from "../../../src/execute/report.js";
import { closeCli, emptyDir, executeArgs, zeroSpendableWorld } from "./close-world.js";

// Review finding AA-9 (story E4-S1) through the CLI: the report that `--json` prints and
// `--report` keeps has the operation summaries and the links the printed receipt shows.

describe("dustin close --execute: the persisted report says what ran and where to look (AA-9)", () => {
  it("carries each operation and the Horizon link of each transaction, and the account links", async () => {
    const world = zeroSpendableWorld({ market: true });
    const path = join(emptyDir(), "close.json");
    const r = await closeCli(world, executeArgs(world, "--yes", "--json", "--report", path));
    expect(r.code).toBe(0);
    const printed = JSON.parse(r.out) as CloseReport;
    const saved = JSON.parse(readFileSync(path, "utf8")) as CloseReport;
    expect(saved).toEqual(printed);
    expect(printed.links).toEqual({
      account: {
        explorer: `https://stellar.expert/explorer/testnet/account/${world.id}`,
        horizon: `https://horizon-testnet.stellar.org/accounts/${world.id}`,
      },
      destination: {
        explorer: `https://stellar.expert/explorer/testnet/account/${world.destination}`,
        horizon: `https://horizon-testnet.stellar.org/accounts/${world.destination}`,
      },
    });
    expect(printed.transactions).toHaveLength(3);
    for (const tx of printed.transactions) {
      expect(tx.horizonUrl).toBe(`https://horizon-testnet.stellar.org/transactions/${tx.hash}`);
      expect(tx.operations?.map((o) => o.stepId)).toEqual(tx.stepIds);
    }
    const [cleanup, sale, merge] = printed.transactions.map((t) => t.operations!);
    expect(cleanup!.map((o) => o.kind)).toEqual(["cancel_offer", "remove_data"]);
    expect(cleanup![0]).toMatchObject({ offerId: "4471", subject: "offer 4471" });
    expect(sale!.map((o) => [o.kind, o.rung ?? null])).toEqual([
      ["dispose_balance", "path_payment"],
      ["remove_trustline", null],
    ]);
    expect(sale![0]).toMatchObject({ asset: `DUST:${world.issuer}`, amount: "0.0000005" });
    expect(merge).toEqual([
      expect.objectContaining({ kind: "merge", type: "accountMerge", to: world.destination }),
    ]);
  });
});
