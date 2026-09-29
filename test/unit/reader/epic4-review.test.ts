import { describe, expect, it } from "vitest";
import {
  PAGE_LIMIT,
  accountOffers,
  horizonJson,
  readPages,
} from "../../../src/reader/horizon-json.js";
import {
  CLAIMANT_PAGES,
  CLAIMANT_READ_LIMIT,
  horizonReader,
} from "../../../src/reader/ledger-reader.js";
import { noSleep } from "../../helpers/no-sleep.js";

// The Epic 4 closing review of 2026-09-29, reader half: every test here failed on the code before
// its fix (the pager probe P-P1 of the review, ported).

const G = "GCPPFHGLKA7GCBWJXBH4EXFXS3OXAMXFLOBAZLU2K3KKMO6JKZORNFW7";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** A Horizon that answers every request with `page(path)`; stops the test after 30 requests. */
function horizon(page: (path: string, n: number) => unknown) {
  const paths: string[] = [];
  const fetch = (url: string) => {
    const path = url.replace("https://horizon-testnet.stellar.org", "");
    paths.push(path);
    if (paths.length > 30) return Promise.reject(new Error("more than 30 requests: no end"));
    return Promise.resolve(json(page(path, paths.length)));
  };
  return {
    client: horizonJson("https://horizon-testnet.stellar.org", {
      fetch,
      sleep: noSleep,
      retries: 0,
    }),
    paths,
  };
}
const full = (token: (i: number) => string | undefined) => ({
  _embedded: {
    records: Array.from({ length: PAGE_LIMIT }, (_, i) => ({
      id: String(i),
      asset: "native",
      amount: "0.0000001",
      ...(token(i) === undefined ? {} : { paging_token: token(i) }),
    })),
  },
});

describe("EP-19: the pager stops on a full page it cannot continue from", () => {
  it("a full page whose last record has no paging_token: HORIZON_UNAVAILABLE after one request, not an endless re-read", async () => {
    // P-P1 of the review: the claimant pager re-read the first page with no end.
    const { client, paths } = horizon(() => full(() => undefined));
    await expect(horizonReader(client).claimableBalancesClaimableBy!(G)).rejects.toMatchObject({
      code: "HORIZON_UNAVAILABLE",
      message: expect.stringContaining("without a paging_token on its last record") as string,
    });
    expect(paths).toEqual([`/claimable_balances?claimant=${G}&limit=200`]);
  });

  it("a full page whose last paging_token repeats the cursor it was asked from", async () => {
    const { client, paths } = horizon(() => full(() => "42"));
    await expect(
      readPages(client, (c) => `/x?limit=200${c ? `&cursor=${c}` : ""}`),
    ).rejects.toMatchObject({
      code: "HORIZON_UNAVAILABLE",
      message: expect.stringContaining("whose last paging_token is the cursor") as string,
    });
    expect(paths).toEqual(["/x?limit=200", "/x?limit=200&cursor=42"]);
  });

  it("the offers and the sponsored-balance pagers are guarded the same way", async () => {
    const offers = horizon(() => full(() => undefined));
    await expect(accountOffers(offers.client, G)).rejects.toMatchObject({
      code: "HORIZON_UNAVAILABLE",
    });
    expect(offers.paths).toHaveLength(1);
    const sponsored = horizon(() => full(() => ""));
    await expect(
      horizonReader(sponsored.client).claimableBalancesSponsoredBy(G),
    ).rejects.toMatchObject({ code: "HORIZON_UNAVAILABLE" });
    expect(sponsored.paths).toHaveLength(1);
  });
});

describe("EP-4: the claimant read is bounded", () => {
  it(`follows at most ${CLAIMANT_PAGES} pages of 200 and returns what they held (${CLAIMANT_READ_LIMIT})`, async () => {
    const { client, paths } = horizon((_, n) => full((i) => `${n}-${i}`));
    const balances = await horizonReader(client).claimableBalancesClaimableBy!(G);
    expect(CLAIMANT_PAGES).toBe(10);
    expect(balances).toHaveLength(CLAIMANT_READ_LIMIT);
    expect(paths).toHaveLength(CLAIMANT_PAGES);
    expect(paths[1]).toBe(`/claimable_balances?claimant=${G}&limit=200&cursor=1-199`);
  });

  it("readPages says whether it reached the end", async () => {
    const endless = horizon((_, n) => full((i) => `${n}-${i}`));
    await expect(readPages(endless.client, (c) => `/x?c=${c}`, 2)).resolves.toMatchObject({
      complete: false,
    });
    const short = horizon(() => ({ _embedded: { records: [{ paging_token: "1" }] } }));
    await expect(readPages(short.client, (c) => `/x?c=${c}`, 2)).resolves.toEqual({
      records: [{ paging_token: "1" }],
      complete: true,
    });
  });
});
