import { vi } from "vitest";

// The unit tier is offline (docs/adr/ADR-0005-testing-strategy.md). The SDK's Horizon client
// uses the global fetch, so replacing it catches every accidental network call.
vi.stubGlobal("fetch", (input: unknown) => {
  const target = input instanceof Request ? input.url : String(input);
  return Promise.reject(new Error(`network access is not allowed in unit tests: ${target}`));
});
