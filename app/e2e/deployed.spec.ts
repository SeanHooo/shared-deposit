/*
 * Smoke-test the deployed build in a real browser, in front of the URL a judge will open.
 *
 * Everything else in this directory runs against a local validator and synthetic wallets,
 * which proves the code but not the deployment: a wrong asset path, a missing header or a
 * bundle that throws on load all pass those tests and fail here. Skipped unless DEMO_URL
 * is set, so the suite stays offline by default.
 *
 *   DEMO_URL=https://shared-passport.vercel.app npm run test:e2e
 */
import { expect, test } from "@playwright/test";

const demoUrl = process.env.DEMO_URL;
test.skip(!demoUrl, "set DEMO_URL to smoke-test a deployed build");

test("the deployed build loads, reports devnet and reads the chain", async ({
  page,
}) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console error: ${m.text()}`);
  });
  page.on("requestfailed", (r) =>
    problems.push(`request failed: ${r.url()} ${r.failure()?.errorText ?? ""}`),
  );
  page.on("response", (r) => {
    if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`);
  });

  await page.goto(demoUrl!, { waitUntil: "load" });

  // Without a wallet the app must still be honest about what it is and where it points.
  await expect(page).toHaveTitle("Shared Deposit Passport");
  await expect(page.getByText("No wallet connected")).toBeVisible();
  await expect(page.getByText("Solana devnet")).toBeVisible();
  for (const role of ["Guest", "Merchant", "Operator", "Keeper"])
    await expect(page.getByRole("button", { name: role })).toBeVisible();

  // It has to reach the cluster too, not just render. The header band prints the slot it
  // read, so a matching number is evidence of a live read rather than of static markup.
  await expect(
    page.getByText(/On-chain state synced \u00b7 slot \d+/),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Chain state is up to date.")).toBeVisible({
    timeout: 30_000,
  });

  await page.screenshot({ path: "test-results/deployed.png", fullPage: true });
  expect(problems).toEqual([]);
});
