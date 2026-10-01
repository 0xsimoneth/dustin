import { Account, MuxedAccount } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { closeCommand, planCommand } from "../src/commands";
import { EXAMPLE } from "../src/example";
import type { PlanInputs } from "../src/inputs";

const base: PlanInputs = {
  account: EXAMPLE.account,
  destination: EXAMPLE.destination,
  sponsor: EXAMPLE.sponsor,
  allowPartial: false,
  preferDestination: false,
};

describe("planCommand", () => {
  it("is the README's dustin plan with --to and --sponsor", () => {
    expect(planCommand(base)).toBe(
      `npx stellar-dustin plan ${EXAMPLE.account} --to ${EXAMPLE.destination} --sponsor ${EXAMPLE.sponsor}`,
    );
  });

  it("uses placeholders for missing or malformed addresses, and never echoes other text", () => {
    expect(planCommand({ ...base, account: "", destination: "", sponsor: "" })).toBe(
      "npx stellar-dustin plan G<ACCOUNT> --to G<DESTINATION>",
    );
    expect(planCommand({ ...base, account: "GABC; rm -rf /", sponsor: "$(whoami)" })).toBe(
      `npx stellar-dustin plan G<ACCOUNT> --to ${EXAMPLE.destination} --sponsor G<SPONSOR>`,
    );
  });

  it("accepts a muxed M... destination and adds --prefer-destination when asked", () => {
    // A real muxed address (StrKey checksum included) of the example destination with id 1; a
    // string that is only shaped like one is a placeholder since the review (W2, W3).
    const muxed = new MuxedAccount(new Account(EXAMPLE.destination, "0"), "1").accountId();
    expect(muxed).toMatch(/^M[A-Z2-7]{68}$/);
    expect(planCommand({ ...base, destination: muxed, preferDestination: true })).toBe(
      `npx stellar-dustin plan ${EXAMPLE.account} --to ${muxed} --sponsor ${EXAMPLE.sponsor} --prefer-destination`,
    );
    expect(planCommand({ ...base, destination: `M${"A".repeat(55)}` })).toContain(
      "--to G<DESTINATION>",
    );
    expect(planCommand({ ...base, destination: `M${"A".repeat(68)}` })).toContain(
      "--to G<DESTINATION>",
    );
  });

  it("has no --partial: that option belongs to close", () => {
    expect(planCommand({ ...base, allowPartial: true })).not.toContain("--partial");
  });
});

describe("closeCommand", () => {
  it("names the two secret variables in comments and never a value, then the command with --execute", () => {
    const text = closeCommand(base);
    const lines = text.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^# .*never from the command line/);
    expect(lines[1]).toContain("DUSTIN_ACCOUNT_SECRET");
    expect(lines[2]).toContain("DUSTIN_SPONSOR_SECRET");
    expect(lines[3]).toBe(
      `npx stellar-dustin close ${EXAMPLE.account} --to ${EXAMPLE.destination} --sponsor ${EXAMPLE.sponsor} --execute`,
    );
    expect(text).not.toMatch(/(?<![A-Z2-7])S[A-Z2-7]{55}(?![A-Z2-7])/);
    expect(text).not.toMatch(/=/);
  });

  it("adds --partial and --prefer-destination after --execute when ticked", () => {
    const text = closeCommand({ ...base, allowPartial: true, preferDestination: true });
    expect(text.split("\n")[3]).toBe(
      `npx stellar-dustin close ${EXAMPLE.account} --to ${EXAMPLE.destination} --sponsor ${EXAMPLE.sponsor} --execute --partial --prefer-destination`,
    );
  });

  it("leaves --sponsor out when none is given", () => {
    expect(closeCommand({ ...base, sponsor: "" }).split("\n")[3]).toBe(
      `npx stellar-dustin close ${EXAMPLE.account} --to ${EXAMPLE.destination} --execute`,
    );
  });
});
