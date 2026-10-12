import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 180000,
  use: { headless: true, actionTimeout: 10000, screenshot: "only-on-failure" },
  reporter: "list",
});
