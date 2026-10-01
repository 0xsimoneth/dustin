import { defineConfig, devices } from "@playwright/test";

// The smoke test drives the built page served by `vite preview`; Horizon is answered from the
// recorded fixtures of test/fixtures/horizon/messy, so no request leaves the machine
// (docs/web-demo.md). Two projects: a desktop window and a phone, both Chromium. The build is the
// caller's: `npm run test:e2e` builds first, CI's build step did (and scanned the bundle), and a
// preview already listening on the port is an error, never reused, so the run is never against a
// stale build (E5-S1 review, EC-8 and BH-4).
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://127.0.0.1:4173/", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173/",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
