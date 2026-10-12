/*
 * Smoke-test the deployed build in a real browser, in front of the URL a judge will open.
 *
 * Everything else in this directory runs against a local validator and synthetic wallets,
 * which proves the code but not the deployment: a wrong asset path, a missing header or a
 * bundle that throws on load all pass those tests and fail here. Skipped unless DEMO_URL
 * is set, so the suite stays offline by default.
 *
 *   DEMO_URL=https://shared-passport.vercel.app npm run test:e2e
 *
 * The addresses below are this deployment's fixed values, recorded in DEPLOYMENT.md. They
 * are pinned on purpose: if the demo is ever redeployed with a fresh platform, these
 * checks should fail until someone looks at what changed, because a smoke test that
 * passes against any deployment is not checking this one.
 */
import { expect, test } from "@playwright/test";
import { generateKeyPairSigner } from "@solana/kit";
import { installWallets, loginAs, openConsole } from "./harness";

const demoUrl = process.env.DEMO_URL;
test.skip(!demoUrl, "set DEMO_URL to smoke-test a deployed build");

const OPERATOR = "CMNgjVqaaopNCZTsKBzD2zVxxQHMrFejNiaQW9iVXrxF";
const USDC_MINT = "5nhW64j6aE93mNUErsKReqNuVm7W62PTVz91WDosnTPo";
const USDT_MINT = "r8AVDLFzWjeMXu9JXKKcnDsghuD4WK7Xs2xdPmg5VsC";
const MERCHANTS = {
  Bikes: "GASM7JmhynusMchjhWjRG6yjtQ9vknQszqgFwsKDVeV6",
  Camping: "2sCWB4oaoqoy11w15oQJdv2QBqLWbwfK6fDZD5xzvBXL",
} as const;

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
  await expect(page.getByText(/On-chain state synced \u00b7 slot \d+/)).toBeVisible(
    { timeout: 30_000 },
  );
  await expect(page.getByText("Chain state is up to date.")).toBeVisible({
    timeout: 30_000,
  });

  await page.screenshot({ path: "test-results/deployed.png", fullPage: true });
  expect(problems).toEqual([]);
});

test("a visitor with no wallet can see the real platform, mints and merchants", async ({
  page,
}) => {
  // This is the cheapest thing a judge can check, and it is the reason the README sends
  // them here first: nothing has to be installed, and every value on screen is an address
  // they can open in an explorer. Asserted because a deployment that renders a shell with
  // empty placeholders would still pass a "does it load" test.
  await page.goto(demoUrl!, { waitUntil: "load" });
  await openConsole(page, "Operator");
  await expect(page.getByText(OPERATOR)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(USDC_MINT)).toBeVisible();
  await expect(page.getByText(USDT_MINT)).toBeVisible();
  for (const [name, address] of Object.entries(MERCHANTS)) {
    await expect(page.getByText(`${name} \u00b7 Enabled`)).toBeVisible();
    await expect(page.getByText(address)).toBeVisible();
  }

  // Reading the activity needs no signature, but the button asks for a wallet first.
  // Asserted as-is rather than described, so the README cannot claim otherwise.
  await expect(
    page.getByRole("button", { name: "Query this role's activity" }),
  ).toBeDisabled();
});

test("a wallet from outside the demo can read the real activity", async ({
  page,
}) => {
  // A judge has no key to this deployment, so the only way they can see the deposit and
  // the two rentals is through an account they do not own. The operator console queries
  // the platform account, not the wallet's own, and the history button only needs *a*
  // wallet connected rather than the operator key - so this is a read-only path that any
  // visitor can walk. Worth checking, because a claim that judges can verify the run
  // themselves should not be a claim made from reading the code.
  await installWallets(page, { Stranger: await generateKeyPairSigner() });
  await page.goto(demoUrl!, { waitUntil: "load" });
  await loginAs(page, "Stranger");
  await openConsole(page, "Operator");

  // Scoped to the activity panel: `article.record` is also how the merchant cards are
  // styled, so an unscoped locator is satisfied before any history is on screen.
  const activity = page.locator(".panel", {
    has: page.getByRole("heading", { name: "On-chain activity" }),
  });
  await page.getByRole("button", { name: "Query this role's activity" }).click();
  await expect(activity.locator("article.record").first()).toBeVisible({
    timeout: 45_000,
  });

  // The names come from the program's own audit codes, so seeing them means the events
  // were decoded off devnet rather than rendered from anything the app brought with it.
  const rows = activity.locator("article.record");
  await expect(rows.filter({ hasText: "Platform initialized" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "Merchant registered" })).toHaveCount(2);
  // The passport, the asset account and the deposit were one transaction, so all three
  // events carry the same signature.
  await expect(rows.filter({ hasText: "Deposit" }).first()).toBeVisible();
  await expect(rows.filter({ hasText: "Passport created" }).first()).toBeVisible();
});
