import { Networks } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EXPLORER_BASE,
  DEFAULT_HORIZON_URL,
  TESTNET_PASSPHRASE,
  configFromEnv,
  resolveConfig,
  verifyHorizonIsTestnet,
} from "../../../src/config/network.js";

describe("resolveConfig", () => {
  it("defaults to testnet", () => {
    expect(resolveConfig()).toEqual({
      horizonUrl: DEFAULT_HORIZON_URL,
      networkPassphrase: TESTNET_PASSPHRASE,
      explorerBaseUrl: DEFAULT_EXPLORER_BASE,
    });
    expect(TESTNET_PASSPHRASE).toBe(Networks.TESTNET);
  });

  it("refuses any other network passphrase before touching the network", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      for (const passphrase of [Networks.PUBLIC, Networks.FUTURENET, "anything"]) {
        expect(() => resolveConfig({ networkPassphrase: passphrase })).toThrow(
          expect.objectContaining({ code: "MAINNET_REFUSED" }),
        );
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("accepts a Horizon override but rejects a malformed URL", () => {
    expect(resolveConfig({ horizonUrl: "http://localhost:8000/" }).horizonUrl).toBe(
      "http://localhost:8000",
    );
    expect(() => resolveConfig({ horizonUrl: "not a url" })).toThrow(
      expect.objectContaining({ code: "CONFIG_INVALID" }),
    );
    expect(() => resolveConfig({ horizonUrl: "ftp://example.com" })).toThrow(
      expect.objectContaining({ code: "CONFIG_INVALID" }),
    );
    for (const url of [
      "https://user:key@h.example",
      "https://h.example/?apikey=x",
      "https://h.example/#x",
    ]) {
      let message = "";
      try {
        resolveConfig({ horizonUrl: url });
      } catch (e) {
        message = (e as Error).message;
        expect(e).toMatchObject({ code: "CONFIG_INVALID" });
      }
      expect(message).not.toContain("key");
    }
  });
});

describe("configFromEnv", () => {
  it("reads only the documented variables and never the secrets", () => {
    const env = {
      DUSTIN_HORIZON_URL: "http://localhost:8000",
      DUSTIN_EXPLORER_BASE: "https://example.org/testnet",
      DUSTIN_SPONSOR_SECRET: "should-not-appear",
    };
    expect(configFromEnv(env)).toEqual({
      horizonUrl: "http://localhost:8000",
      explorerBaseUrl: "https://example.org/testnet",
    });
    expect(configFromEnv({})).toEqual({});
  });
});

describe("verifyHorizonIsTestnet", () => {
  const respond = (body: unknown, status = 200) =>
    vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify(body), { status })),
    );

  it("passes when Horizon reports the testnet passphrase", async () => {
    const fetchImpl = respond({ network_passphrase: TESTNET_PASSPHRASE });
    await expect(verifyHorizonIsTestnet(DEFAULT_HORIZON_URL, fetchImpl)).resolves.toBeUndefined();
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(`${DEFAULT_HORIZON_URL}/`);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("refuses a Horizon that serves another network", async () => {
    const fetchImpl = respond({ network_passphrase: Networks.PUBLIC });
    await expect(verifyHorizonIsTestnet("https://h.example", fetchImpl)).rejects.toMatchObject({
      code: "MAINNET_REFUSED",
    });
  });

  it("treats a non-Horizon answer as a configuration error, not a retry", async () => {
    const html = vi.fn(() => Promise.resolve(new Response("<html>portal</html>", { status: 200 })));
    await expect(verifyHorizonIsTestnet("https://h.example", html)).rejects.toMatchObject({
      code: "CONFIG_INVALID",
      retryable: false,
    });
    await expect(verifyHorizonIsTestnet("https://h.example", respond(null))).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
    await expect(
      verifyHorizonIsTestnet("https://h.example", respond({}, 404)),
    ).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
  });

  it("reports an unreachable Horizon as retryable", async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error("ECONNREFUSED")));
    // Its retries wait on an injected pause (Epic 4 review D-3).
    const quick = { sleep: () => Promise.resolve() };
    await expect(
      verifyHorizonIsTestnet("https://h.example", fetchImpl, quick),
    ).rejects.toMatchObject({
      code: "HORIZON_UNAVAILABLE",
      retryable: true,
    });
    await expect(
      verifyHorizonIsTestnet("https://h.example", respond({ error: "x" }, 503), quick),
    ).rejects.toMatchObject({ code: "HORIZON_UNAVAILABLE" });
  });
});

describe("D-3: verifyHorizonIsTestnet retries as the read client does", () => {
  const testnet = () =>
    new Response(JSON.stringify({ network_passphrase: TESTNET_PASSPHRASE }), { status: 200 });

  /** A fetch that answers with `answers` in turn, and the pauses taken between them. */
  function scripted(...answers: Array<"drop" | number | "testnet">) {
    const pauses: number[] = [];
    let call = 0;
    const fetchImpl = vi.fn(() => {
      const answer = answers[Math.min(call++, answers.length - 1)]!;
      if (answer === "drop") return Promise.reject(new Error("socket hang up"));
      if (answer === "testnet") return Promise.resolve(testnet());
      return Promise.resolve(new Response("{}", { status: answer }));
    });
    const sleep = (ms: number) => {
      pauses.push(ms);
      return Promise.resolve();
    };
    return { fetchImpl, pauses, sleep };
  }

  it("D-3: one dropped request is asked again after a pause, and the check passes", async () => {
    const s = scripted("drop", "testnet");
    // Before the fix: HORIZON_UNAVAILABLE at once, which the CLI ends with exit 6.
    await expect(
      verifyHorizonIsTestnet("https://h.example", s.fetchImpl, { sleep: s.sleep }),
    ).resolves.toBeUndefined();
    expect(s.fetchImpl).toHaveBeenCalledTimes(2);
    expect(s.pauses).toEqual([1000]);
  });

  it("D-3: 429 and 5xx are asked again too; the backoff doubles, three retries at most", async () => {
    const passes = scripted(429, 503, "testnet");
    await verifyHorizonIsTestnet("https://h.example", passes.fetchImpl, { sleep: passes.sleep });
    expect(passes.pauses).toEqual([1000, 2000]);
    const down = scripted("drop");
    await expect(
      verifyHorizonIsTestnet("https://h.example", down.fetchImpl, { sleep: down.sleep }),
    ).rejects.toMatchObject({ code: "HORIZON_UNAVAILABLE" });
    expect(down.fetchImpl).toHaveBeenCalledTimes(4);
    expect(down.pauses).toEqual([1000, 2000, 4000]);
  });

  it("D-3: an answer that is not a testnet Horizon is refused at once, without a retry", async () => {
    const s = scripted(404);
    await expect(
      verifyHorizonIsTestnet("https://h.example", s.fetchImpl, { sleep: s.sleep }),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("D-3: the retries and the backoff are the caller's, as for the read client", async () => {
    const s = scripted("drop");
    await expect(
      verifyHorizonIsTestnet("https://h.example", s.fetchImpl, {
        retries: 1,
        backoffMs: 250,
        sleep: s.sleep,
      }),
    ).rejects.toMatchObject({ code: "HORIZON_UNAVAILABLE" });
    expect(s.pauses).toEqual([250]);
    await expect(
      verifyHorizonIsTestnet("https://h.example", s.fetchImpl, { backoffMs: 0 }),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  });
});
