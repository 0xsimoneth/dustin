// stellar-dustin/testing: fixture accounts and recorded Horizon responses for an integrator's own
// tests (architecture section 9; PRD decision D-18). The builders make every account they need
// with a fresh key from Keypair.random() and fund it from Friendbot: no builder reads a secret
// from the environment or asks the caller for one, and the keys come back to the caller only
// through `onKeys` and the result. Testnet only, as the rest of the package.
import {
  DEFAULT_HORIZON_URL,
  TESTNET_PASSPHRASE,
  assertTestnetPassphrase,
  resolveConfig,
  verifyHorizonIsTestnet,
  type DustinConfig,
} from "./config/network.js";
import type { RecordedResponse } from "./fixture/builder.js";
import type { FixtureManifest } from "./fixture/manifest.js";
import { loadMessyVerifyInput, verifyFixture, type VerifyResult } from "./fixture/verify.js";
import { horizonJson, type FetchLike } from "./reader/horizon-json.js";
import { horizonReader, type LedgerReader } from "./reader/ledger-reader.js";

// The fixture builders: `messy` (the SOW's success-metric account) and `edge` (one throwaway
// account per edge case of the test matrix).
export { buildMessyFixture, fixtureId } from "./fixture/builder.js";
export type { BuildOptions, BuildResult, RecordedResponse } from "./fixture/builder.js";
export { buildEdgeFixture } from "./fixture/edge-builder.js";
export type { EdgeBuildOptions, EdgeBuildResult } from "./fixture/edge-builder.js";
export { MESSY, MESSY_ROLES } from "./fixture/messy.js";
export type { MessyAsset, MessyOffer, MessyRole, MessyRoles } from "./fixture/messy.js";

// Checking a fixture against Horizon, and against a testnet reset.
export {
  expectationFromManifest,
  loadMessyVerifyInput,
  loadVerifyInput,
  renderVerify,
  verifyFixture,
} from "./fixture/verify.js";
export type {
  VerifyCheck,
  VerifyExpectation,
  VerifyInput,
  VerifyResult,
} from "./fixture/verify.js";
export { loadEdgeVerifyInput, verifyEdgeFixture } from "./fixture/edge-verify.js";
export type { EdgeVerifyInput } from "./fixture/edge-verify.js";
export { assertNoReset } from "./fixture/reset.js";

// The manifests `dustin fixture create` writes: public keys, assets, offers, expected figures.
export { readAnyManifest, readManifest } from "./fixture/manifest.js";
export type {
  EdgeFixtureKeys,
  EdgeFixtureManifest,
  FixtureKeys,
  FixtureManifest,
} from "./fixture/manifest.js";

/**
 * A fetch that answers from recorded Horizon responses, such as the `recorded` of a built fixture,
 * and never touches the network: Horizon's root names the testnet, each recorded path answers its
 * recorded status and body, and any other path answers 404 as Horizon does.
 */
export function recordedFetch(
  recorded: Readonly<Record<string, RecordedResponse>>,
  horizonUrl: string = DEFAULT_HORIZON_URL,
): FetchLike {
  const byPath = new Map(Object.values(recorded).map((r) => [r.path, r]));
  const answer = (status: number, body: unknown) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/hal+json" },
      }),
    );
  return (url) => {
    const path = url.startsWith(horizonUrl) ? url.slice(horizonUrl.length) : url;
    if (path === "/" || path === "") return answer(200, { network_passphrase: TESTNET_PASSPHRASE });
    const hit = byPath.get(path);
    return hit
      ? answer(hit.status, hit.body)
      : answer(404, { status: 404, title: "Resource Missing" });
  };
}

/**
 * A ledger reader over recorded Horizon responses, for planning offline in a test:
 * `planClose({ account, destination }, { reader: recordedReader(built.recorded) })`.
 */
export function recordedReader(
  recorded: Readonly<Record<string, RecordedResponse>>,
  horizonUrl: string = DEFAULT_HORIZON_URL,
): LedgerReader {
  return horizonReader(
    horizonJson(horizonUrl, { fetch: recordedFetch(recorded, horizonUrl), retries: 0 }),
  );
}

export interface CheckFixtureOptions {
  /** The Horizon to ask; it must serve the testnet. */
  config?: DustinConfig;
  /** HTTP for the requests (tests). */
  fetch?: FetchLike;
}

/**
 * Checks a messy fixture against Horizon as `dustin fixture verify` does: the manifest and Horizon
 * must name the testnet, a testnet reset is refused with `RESET_SUSPECTED`, and the result lists
 * every check, the SOW Appendix B preconditions among them (`pass` is true when all hold).
 */
export async function checkMessyFixture(
  manifest: FixtureManifest,
  options: CheckFixtureOptions = {},
): Promise<VerifyResult> {
  assertTestnetPassphrase(manifest.network.passphrase);
  const config = resolveConfig(options.config);
  await verifyHorizonIsTestnet(config.horizonUrl, options.fetch);
  const client = horizonJson(config.horizonUrl, options.fetch ? { fetch: options.fetch } : {});
  return verifyFixture(await loadMessyVerifyInput(client, manifest));
}
