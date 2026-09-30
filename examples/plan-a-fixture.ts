// Builds a messy fixture account on the Stellar testnet with stellar-dustin/testing, checks it
// against SOW Appendix B, and plans its close offline from the Horizon responses the build
// recorded: the way to test your own planning code on a known account (PRD decision D-18).
//
//   node plan-a-fixture.js    (compiled with tsc, or run with any TypeScript runner)
//
// It needs no secret: every account of the fixture gets a new key from Keypair.random() and is
// funded by Friendbot. The keys come back only through `onKeys`; this example writes them to a
// file only the user can read, because they are needed to close the fixture later. Testnet only.
// CI type-checks this file against the package's published types (`npm run typecheck:examples`).
import { writeFileSync } from "node:fs";
import { planClose, renderPlan } from "stellar-dustin";
import {
  buildMessyFixture,
  checkMessyFixture,
  recordedReader,
  renderVerify,
} from "stellar-dustin/testing";

const built = await buildMessyFixture({
  log: (line) => console.error(line),
  onKeys: (keys) => writeFileSync(`${keys.id}-keys.json`, JSON.stringify(keys), { mode: 0o600 }),
});
const { fixture, destination, sponsor } = built.manifest.accounts;

// The Appendix B checks, against Horizon now (as `dustin fixture verify` does).
const checked = await checkMessyFixture(built.manifest);
console.log(renderVerify(checked));

// The plan, offline: the reader answers from the responses recorded at the end of the build.
const plan = await planClose(
  { account: fixture, destination, feeSponsor: sponsor },
  { reader: recordedReader(built.recorded) },
);
console.log(renderPlan(plan));
process.exitCode = checked.pass && plan.status === "closable" ? 0 : 1;
