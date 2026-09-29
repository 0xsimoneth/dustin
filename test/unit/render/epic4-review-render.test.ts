import { describe, expect, it } from "vitest";
import { executeClose } from "../../../src/execute/executor.js";
import { nextStep, renderReport } from "../../../src/render/report-text.js";
import { harness, reply, signers } from "../execute/harness.js";

// Epic 4 closing review, the receipt. Each test is named after its finding ID and fails on the
// code before the fix. Reports come from the real executor on the fake ledger.

describe("EX-5: the Next line of a stop with an open envelope names its time bound", () => {
  it("EX-5: OUTCOME_UNKNOWN says to wait until a ledger has closed past maxTime", async () => {
    // A 504 on the POST, then every lookup by hash fails: whether it applied is not known.
    const { ledger, deps, plan } = harness(
      (_l, fetch) => (url, init) =>
        url.includes("/transactions/") ? reply(503) : fetch(url, init),
    );
    ledger.faults.push("504-applied");
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    expect(report.stop).toMatchObject({ code: "OUTCOME_UNKNOWN" });
    const maxTime = report.stop!.maxTime!;
    expect(maxTime).toBeTypeOf("number");
    const next = nextStep(report)!;
    const bound = new Date(maxTime * 1000).toISOString();
    // Before the fix: "Run the same command again to continue: ...", with no wait.
    expect(next).toContain(`only after a ledger has closed after ${bound} (maxTime ${maxTime})`);
    expect(next).toContain(report.stop!.hash!);
    expect(renderReport(report).replace(/\s+/g, " ")).toContain(
      `Run the same command again only after a ledger has closed after ${bound}`,
    );
  });

  it("EX-5: INTERRUPTED with an open envelope says the same", async () => {
    const controller = new AbortController();
    let posts = 0;
    const { ledger, deps, plan } = harness((_l, fetch) => (url, init) => {
      // The signal comes as the first envelope reaches Horizon, which loses it behind a 504.
      if ((init?.method ?? "GET") === "POST" && ++posts === 1) controller.abort("SIGINT");
      return fetch(url, init);
    });
    ledger.faults.push("504-not-applied");
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      signal: controller.signal,
    });
    expect(report.stop).toMatchObject({ code: "INTERRUPTED" });
    const maxTime = report.stop!.maxTime!;
    expect(maxTime).toBeTypeOf("number");
    expect(nextStep(report)).toContain(
      `only after a ledger has closed after ${new Date(maxTime * 1000).toISOString()}`,
    );
  });

  it("EX-5: a stop without an open envelope keeps its Next line", async () => {
    const controller = new AbortController();
    const { deps, plan } = harness();
    controller.abort("SIGINT");
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      signal: controller.signal,
    });
    expect(report.stop).toMatchObject({ code: "INTERRUPTED" });
    expect(report.stop!.maxTime).toBeUndefined();
    expect(nextStep(report)).toBe(
      "Nothing was submitted. Review the plan and run the command again.",
    );
  });
});
