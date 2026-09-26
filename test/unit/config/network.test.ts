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
    await expect(verifyHorizonIsTestnet("https://h.example", fetchImpl)).rejects.toMatchObject({
      code: "HORIZON_UNAVAILABLE",
      retryable: true,
    });
    await expect(
      verifyHorizonIsTestnet("https://h.example", respond({ error: "x" }, 503)),
    ).rejects.toMatchObject({ code: "HORIZON_UNAVAILABLE" });
  });
});
