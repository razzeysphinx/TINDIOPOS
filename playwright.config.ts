import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e/phase-14",

  fullyParallel: false,

  workers: 1,

  retries: 0,

  timeout: 90_000,

  expect: {
    timeout: 15_000,
  },

  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/phase-14-playwright-results.json" }],
  ],

  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    viewport: {
      width: 1440,
      height: 1000,
    },
  },

  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],

  webServer: {
    command: "pnpm exec next start -p 3100",
    url: "http://127.0.0.1:3100/login",
    reuseExistingServer: false,
    timeout: 120_000,
  },

  outputDir: "test-results/phase-14-artifacts",
});
