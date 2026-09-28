import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Prompt } from "../../../src/cli/commands/close.js";
import { run } from "../../../src/cli/run.js";
import type { SecretPrompt } from "../../../src/cli/secrets.js";
import type { executeClose } from "../../../src/execute/executor.js";
import { noSleep } from "../../helpers/no-sleep.js";
import {
  emptyDir,
  executeArgs,
  zeroSpendableWorld,
  type Fetch,
  type World,
} from "./close-world.js";

// AC-E4-S2-3 (story E4-S2): no unhandled promise rejection escapes the CLI, and `run()` itself
// never rejects, whatever the parts it drives throw or reject with: values that are not errors,
// values whose conversion to text throws, prompts and streams that fail. The harness listens for
// Node's `unhandledRejection` event (https://nodejs.org/api/process.html#event-unhandledrejection)
// through every scenario and lets the event loop turn after each, so a late rejection is caught.

const rejections: unknown[] = [];
const listener = (reason: unknown) => void rejections.push(reason);
beforeEach(() => {
  rejections.length = 0;
  process.on("unhandledRejection", listener);
});
afterEach(() => {
  process.off("unhandledRejection", listener);
});

/** A few turns of the event loop, so that a rejection left unhandled is reported. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

interface Scenario {
  name: string;
  args: (world: World) => string[];
  env?: (world: World) => Record<string, string | undefined>;
  fetch?: (world: World) => Fetch;
  executeClose?: typeof executeClose;
  prompt?: Prompt;
  secretPrompt?: SecretPrompt;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

/** A value whose conversion to text throws: `String()` of it fails. */
const textless = () => Object.create(null) as object;

/** A promise rejected with `value`, which need not be an Error: the case under test. */
const rejectWith = (value: unknown): Promise<never> =>
  // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the case under test
  Promise.reject(value);

const scenarios: Scenario[] = [
  {
    name: "an executor that rejects with a value that has no text",
    args: (w) => executeArgs(w, "--yes"),
    executeClose: () => rejectWith(textless()),
  },
  {
    name: "an executor that rejects with undefined",
    args: (w) => executeArgs(w, "--yes", "--json"),
    executeClose: () => rejectWith(undefined),
  },
  {
    name: "an executor that throws synchronously",
    args: (w) => executeArgs(w, "--yes"),
    executeClose: () => {
      throw new RangeError("synchronous");
    },
  },
  {
    name: "an executor that fails after reporting a submission, with no text",
    args: (w) => executeArgs(w, "--yes", "--report", `${emptyDir()}/r.json`),
    executeClose: (plan, _signers, options) => {
      options.onEvent?.({
        type: "tx:submitted",
        index: 0,
        hash: "a".repeat(64),
        explorerUrl: "https://stellar.expert/explorer/testnet/tx/a",
      });
      return rejectWith(textless());
    },
  },
  {
    name: "a fetch that rejects with a number",
    args: (w) => ["plan", w.id, "--to", w.destination],
    fetch: () => () => rejectWith(42),
  },
  {
    name: "a fetch that rejects with a value that has no text, in machine mode",
    args: (w) => ["plan", w.id, "--to", w.destination, "--json"],
    fetch: () => () => rejectWith(textless()),
  },
  {
    name: "a confirmation prompt that rejects",
    args: (w) => executeArgs(w),
    prompt: () => Promise.reject(new Error("the terminal went away")),
  },
  {
    name: "a secret prompt that rejects",
    args: (w) => executeArgs(w, "--yes"),
    env: () => ({}),
    secretPrompt: () => rejectWith(textless()),
  },
  {
    name: "a standard output that throws on every write",
    args: (w) => executeArgs(w, "--yes"),
    stdout: () => {
      throw new Error("EPIPE");
    },
  },
  {
    name: "both streams throwing on every write",
    args: (w) => executeArgs(w, "--yes"),
    executeClose: () => Promise.reject(new Error("boom")),
    stdout: () => {
      throw new Error("EPIPE");
    },
    stderr: () => {
      throw new Error("EPIPE");
    },
  },
];

describe("no unhandled promise rejection escapes the CLI (AC-E4-S2-3)", () => {
  it.each(scenarios.map((s) => [s.name, s] as const))("%s", async (_name, scenario) => {
    const world = zeroSpendableWorld();
    const code = await run(
      ["node", "dustin", ...scenario.args(world)],
      {
        stdout: scenario.stdout ?? (() => undefined),
        stderr: scenario.stderr ?? (() => undefined),
      },
      "0.0.0",
      {
        env: scenario.env ? scenario.env(world) : world.env,
        cwd: emptyDir(),
        fetch: scenario.fetch ? scenario.fetch(world) : world.ledger.fetch,
        horizon: { retries: 0 },
        execute: {
          sleep: noSleep,
          ...(scenario.executeClose ? { executeClose: scenario.executeClose } : {}),
        },
        ...(scenario.prompt ? { prompt: scenario.prompt } : {}),
        ...(scenario.secretPrompt ? { secretPrompt: scenario.secretPrompt } : {}),
      },
    );
    await settle();
    expect(typeof code).toBe("number");
    expect([0, 1, 2, 3, 4, 5, 6]).toContain(code);
    expect(rejections).toEqual([]);
  });
});
