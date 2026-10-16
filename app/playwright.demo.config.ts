import { defineConfig } from "@playwright/test";

/**
 * The interactive demo: a person clicks, so nothing may time out and the browser has to be
 * visible.
 *
 * This lives in its own config, with its own test directory, because those two settings are
 * exactly what an automated suite must not have. If the demo spec were picked up by
 * `npm run test:e2e`, the suite would wait forever for a human to close a window that a
 * judge's machine will never show, and the failure would look like our application hanging.
 *
 * `DEMO_HEADLESS=1` exists so this file can also be smoke-checked without a human.
 */
export default defineConfig({
  testDir: "./demo",
  workers: 1,
  timeout: 0,
  reporter: [["list"]],
  use: {
    headless: process.env.DEMO_HEADLESS === "1",
    viewport: null,
    launchOptions: { args: ["--start-maximized"] },
    // The session is recorded as a webm under test-results/. It is not the demo video -
    // nothing narrates it and the browser chrome is absent - but it is a free record of
    // what a run actually did.
    video: "on",
  },
});
