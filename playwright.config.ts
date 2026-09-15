import { defineConfig } from "@playwright/test";

/**
 * End-to-end smoke tests.
 *
 * Scope is deliberately narrow: prove the built extension actually loads in a
 * real browser and its pages render. Behavioural assertions belong in
 * `bun test` until there is behaviour to assert.
 *
 * There is no pixel comparison. `toHaveScreenshot` baselines generated on
 * macOS fail against Linux CI on font rendering alone, and the UI is not
 * stable enough to be worth pinning. Screenshots are captured on failure as
 * artifacts instead. See docs/testing.md.
 *
 * Requires a production build first — `bun test:e2e` does that for you.
 *
 * Chromium only — see docs/testing.md for why there is no Firefox e2e
 * equivalent (Playwright cannot load an unsigned extension into Firefox at
 * all; that's not a config gap here, it's an upstream limitation).
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: false, // Each test launches its own browser with the extension.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",

  use: {
    baseURL: "http://localhost:4173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },

  // Serves test-site/ for the fixture specs.
  webServer: {
    command: "bun run dev:site",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
  },
});
