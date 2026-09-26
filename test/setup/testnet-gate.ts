// Runs once in the main vitest process for the testnet project, so the skip reason is always visible.
export default function setup(): void {
  if (process.env.DUSTIN_TESTNET !== "1") {
    console.warn("testnet tier skipped: set DUSTIN_TESTNET=1 to run it against the public testnet");
  }
}
