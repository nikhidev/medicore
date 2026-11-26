import { defineConfig } from "@playwright/test";
export default defineConfig({
  testMatch: "**/*.spec.mjs",
  testDir: "tests",
  use: {
    baseURL: process.env.TEST_URL ?? "http://127.0.0.1:3080",
    launchOptions: { executablePath: process.env.BROWSER_EXECUTABLE },
  },
  webServer: process.env.TEST_URL
    ? undefined
    : {
        command: "node scripts/local.mjs",
        url: "http://127.0.0.1:3080",
        reuseExistingServer: true,
        timeout: 120000,
        env: {
          WEB_PORT: "3080",
          API_PORT: "4080",
          DATA_DIR: ".data/playwright",
        },
      },
});
