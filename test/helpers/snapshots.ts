import { inspectAccount } from "../../src/inspect/inspect.js";
import type { ExistingAccountSnapshot } from "../../src/inspect/snapshot.js";
import { horizonJson } from "../../src/reader/horizon-json.js";
import { horizonReader } from "../../src/reader/ledger-reader.js";
import {
  MESSY_DIR,
  TESTNET_HORIZON,
  loadRecorded,
  messyManifest,
  recordedFetch,
} from "./recorded-horizon.js";

export const messy = messyManifest().accounts;

/** The recorded live messy fixture as an inspector snapshot (offline). */
export async function messySnapshot(): Promise<ExistingAccountSnapshot> {
  const { fetch } = recordedFetch(loadRecorded(MESSY_DIR));
  const reader = horizonReader(horizonJson(TESTNET_HORIZON, { fetch, retries: 0, backoffMs: 0 }));
  const s = await inspectAccount(messy.fixture, { destination: messy.destination, reader });
  if (!s.exists) throw new Error("recorded fixture missing");
  return s;
}

/** A deep copy that tests may mutate. */
export function copy<T>(value: T): T {
  return structuredClone(value);
}
