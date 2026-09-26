import { beforeAll, describe, expect, it } from "vitest";
import type { ExistingAccountSnapshot } from "../../../src/inspect/snapshot.js";
import { orderClose } from "../../../src/plan/order.js";
import { recoverySummary } from "../../../src/plan/recovery.js";
import { copy, messy, messySnapshot } from "../../helpers/snapshots.js";

let base: ExistingAccountSnapshot;
beforeAll(async () => {
  base = await messySnapshot();
});

describe("recoverySummary", () => {
  it("sends the balance plus quoted proceeds to the destination and attributes sponsored reserves", () => {
    const r = recoverySummary(
      base,
      orderClose(base, { destination: messy.destination }).units.flatMap((u) => u.steps),
    );
    expect(r).toEqual({
      xlmToDestination: "4.0000007",
      nativeBalance: "4.0000000",
      quotedProceedsXlm: "0.0000007",
      reservesReturnedToSponsors: [
        {
          sponsor: messy.reserveSponsor,
          xlm: "0.5000000",
          entries: [`trustline SPTA:${messy.issuer}`],
        },
      ],
      feesPaidByAccount: "0",
    });
  });

  it("attributes a sponsored account entry (2 reserves) and sponsored signers and offers", () => {
    const s = copy(base);
    s.sponsor = messy.reserveSponsor;
    s.offers[0]!.sponsor = messy.marketMaker;
    s.signers.push({
      key: messy.issuer,
      weight: 1,
      type: "ed25519_public_key",
      sponsor: messy.marketMaker,
    });
    const r = recoverySummary(
      s,
      orderClose(s, { destination: messy.destination }).units.flatMap((u) => u.steps),
    );
    const bySponsor = Object.fromEntries(
      r.reservesReturnedToSponsors.map((x) => [x.sponsor, x.xlm]),
    );
    expect(bySponsor[messy.reserveSponsor]).toBe("1.5000000");
    expect(bySponsor[messy.marketMaker]).toBe("1.0000000");
  });
});
