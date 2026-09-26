import { describe, expect, it, vi } from "vitest";
import { accountOffers, horizonJson, latestLedger } from "../../../src/reader/horizon-json.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("horizonJson", () => {
  it("returns the parsed body, and null for 404", async () => {
    const fetch = vi.fn((url: string) =>
      Promise.resolve(url.endsWith("/missing") ? json({ status: 404 }, 404) : json({ ok: 1 })),
    );
    const client = horizonJson("https://h.example", { fetch, backoffMs: 0 });
    await expect(client.get("/present")).resolves.toEqual({ ok: 1 });
    await expect(client.get("/missing")).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledWith("https://h.example/present", expect.anything());
  });

  it("retries 429, 5xx and network errors, then gives up with HORIZON_UNAVAILABLE", async () => {
    const fetch = vi
      .fn<(url: string) => Promise<Response>>()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(json({}, 429))
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json({ ok: 2 }));
    const client = horizonJson("https://h.example", { fetch, backoffMs: 0 });
    await expect(client.get("/x")).resolves.toEqual({ ok: 2 });

    const down = horizonJson("https://h.example", {
      fetch: () => Promise.resolve(json({}, 503)),
      retries: 2,
      backoffMs: 0,
    });
    await expect(down.get("/x")).rejects.toMatchObject({
      code: "HORIZON_UNAVAILABLE",
      retryable: true,
    });
  });

  it("does not retry other client errors", async () => {
    const fetch = vi.fn(() => Promise.resolve(json({}, 400)));
    await expect(
      horizonJson("https://h.example", { fetch, backoffMs: 0 }).get("/x"),
    ).rejects.toMatchObject({
      code: "HORIZON_UNAVAILABLE",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("accountOffers", () => {
  it("follows 200-record pages to the end", async () => {
    const record = (i: number) => ({ id: String(i), paging_token: String(i) });
    const pages = [Array.from({ length: 200 }, (_, i) => record(i + 1)), [record(201)]];
    const fetch = vi.fn((url: string) => {
      const page = url.includes("cursor=200") ? pages[1] : pages[0];
      return Promise.resolve(json({ _embedded: { records: page } }));
    });
    const offers = await accountOffers(
      horizonJson("https://h.example", { fetch, backoffMs: 0 }),
      "GABC",
    );
    expect(offers).toHaveLength(201);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("returns no offers for an account that does not exist", async () => {
    const fetch = () => Promise.resolve(json({}, 404));
    await expect(
      accountOffers(horizonJson("https://h.example", { fetch }), "GABC"),
    ).resolves.toEqual([]);
  });
});

describe("latestLedger", () => {
  it("reads the newest ledger record", async () => {
    const ledger = {
      sequence: 5,
      closed_at: "t",
      base_fee_in_stroops: 100,
      base_reserve_in_stroops: 5000000,
      protocol_version: 28,
    };
    const fetch = () => Promise.resolve(json({ _embedded: { records: [ledger] } }));
    await expect(latestLedger(horizonJson("https://h.example", { fetch }))).resolves.toEqual(
      ledger,
    );
  });
});

describe("horizonJson robustness", () => {
  it("passes a timeout signal and survives a non-JSON body", async () => {
    const fetch = vi.fn((_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve(new Response("<html>", { status: 200 }));
    });
    await expect(
      horizonJson("https://h.example", { fetch, retries: 1, backoffMs: 0 }).get("/x"),
    ).rejects.toMatchObject({ code: "HORIZON_UNAVAILABLE" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
