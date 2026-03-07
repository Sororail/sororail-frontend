import { defineConfig, devices } from "@playwright/test";

/**
 * The wallet is a browser extension and cannot be driven here, so specs stub
 * `window.freighterApi`. That still exercises the real connect path through
 * the app and the SDK adapter — everything short of the extension itself.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3210",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm exec next start -p 3210",
    url: "http://127.0.0.1:3210",
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
  },
});
