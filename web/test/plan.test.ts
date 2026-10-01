import { DustinError } from "stellar-dustin";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlanInputs } from "../src/inputs";
import { describeError, isDustinError, planInBrowser } from "../src/plan";
import { loadRecorded, messyAccounts, recordedFetch } from "./helpers/recorded";

const recorded = loadRecorded();
const messy = messyAccounts();
const inputs = (over: Partial<PlanInputs> = {}): PlanInputs => ({
  account: messy.fixture,
  destination: messy.destination,
  sponsor: messy.sponsor,
  allowPartial: false,
  preferDestination: false,
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe("planInBrowser", () => {
  it("plans with GET requests to Horizon only, and nothing else", async () => {
    const { fetch, requests } = recordedFetch(recorded);
    vi.stubGlobal("fetch", fetch);
    const plan = await planInBrowser(inputs());
    expect(plan.status).toBe("closable");
    expect(plan.feeSponsor).toBe(messy.sponsor);
    expect(plan.ladderOrder).toBe("sow");
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((r) => r.method === "GET")).toBe(true);
    expect(requests.some((r) => /transactions/.test(r.path))).toBe(false);
  });

  it("records --prefer-destination as the ladder order", async () => {
    vi.stubGlobal("fetch", recordedFetch(recorded).fetch);
    const plan = await planInBrowser(inputs({ preferDestination: true }));
    expect(plan.ladderOrder).toBe("prefer-destination");
  });

  it("without a destination, inspects the account and plans a DESTINATION_MISSING blocked plan", async () => {
    const { fetch, requests } = recordedFetch(recorded);
    vi.stubGlobal("fetch", fetch);
    const plan = await planInBrowser(inputs({ destination: "" }));
    expect(plan.status).toBe("blocked");
    expect(plan.destination).toBe("");
    expect(plan.blockers.map((b) => b.code)).toEqual(["DESTINATION_MISSING"]);
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(requests.some((r) => r.path === `/accounts/${messy.destination}`)).toBe(false);
  });

  it("without a destination, still refuses a malformed sponsor or the account as sponsor before reading", async () => {
    const { fetch, requests } = recordedFetch(recorded);
    vi.stubGlobal("fetch", fetch);
    await expect(planInBrowser(inputs({ destination: "", sponsor: "GABC" }))).rejects.toMatchObject(
      { code: "INVALID_ADDRESS" },
    );
    await expect(
      planInBrowser(inputs({ destination: "", sponsor: messy.fixture })),
    ).rejects.toMatchObject({ code: "INVALID_ADDRESS", message: /different account/ });
    expect(requests).toEqual([]);
  });

  it("passes the SDK's errors through: an invalid account, a contract address", async () => {
    vi.stubGlobal("fetch", recordedFetch(recorded).fetch);
    await expect(planInBrowser(inputs({ account: "GABC" }))).rejects.toMatchObject({
      code: "INVALID_ADDRESS",
    });
    // The contract address of 32 zero bytes (StrKey.encodeContract), a valid C... address.
    const contract = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
    await expect(planInBrowser(inputs({ account: contract }))).rejects.toMatchObject({
      code: "CONTRACT_ACCOUNT",
    });
  });

  it("reports Horizon's failure as HORIZON_UNAVAILABLE", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(new Response("down", { status: 400, statusText: "Bad Request" })),
    );
    await expect(planInBrowser(inputs())).rejects.toMatchObject({ code: "HORIZON_UNAVAILABLE" });
  });
});

describe("describeError", () => {
  it("gives a DustinError a title, its sentence and its remedy", () => {
    const error = new DustinError(
      "INVALID_ADDRESS",
      "The account to close is not a valid G... address.",
      {
        stage: "inspect",
        remedy: "Check the address: a classic account is 56 characters starting with G.",
      },
    );
    expect(isDustinError(error)).toBe(true);
    expect(describeError(error)).toEqual({
      code: "INVALID_ADDRESS",
      title: "That address is not valid",
      message: "The account to close is not a valid G... address.",
      remedy: "Check the address: a classic account is 56 characters starting with G.",
    });
  });

  it("falls back to the code's default remedy and a code title", () => {
    const error = new DustinError("HORIZON_UNAVAILABLE", "Horizon at x is unreachable.", {
      stage: "inspect",
    });
    const plain = describeError(error);
    expect(plain.title).toBe("Horizon could not be reached");
    expect(plain.remedy).toMatch(/network connection|Horizon URL/);
    const odd = new DustinError("NOT_IMPLEMENTED", "No.", { stage: "plan" });
    expect(describeError(odd).title).toBe("Error NOT_IMPLEMENTED");
  });

  it("describes any other error as unexpected, with its message", () => {
    expect(describeError(new TypeError("boom"))).toMatchObject({
      code: null,
      title: "Unexpected error",
      message: "boom",
    });
    expect(describeError("text")).toMatchObject({ code: null, message: "text" });
    expect(isDustinError(new Error("x"))).toBe(false);
  });
});
