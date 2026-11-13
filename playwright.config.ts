import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests: click through the real app in Chromium. AI routes are
 * mocked per test so runs are deterministic and cost nothing; Postgres
 * (PGlite) runs for real in the browser.
 */
const PORT = Number(process.env.E2E_PORT ?? 3123);

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } }],
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
