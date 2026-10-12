import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import * as p from "../src/program";
import { loadSnapshot, makeRpc } from "../src/chain";
import {
  UI,
  authorizeRental,
  installWallets,
  loginAs,
  openConsole,
  selectAsset,
  startHarness,
  transact,
  type Harness,
} from "./harness";

let h: Harness;
test.beforeAll(async () => {
  h = await startHarness();
});
test.afterAll(() => {
  h?.stop();
});

/**
 * Console screenshots for the README. Taken at the default 1280 viewport from
 * this same run, so they show state produced by real signed transactions on a
 * real validator rather than a mocked page.
 */
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `../docs/screenshots/${name}.png`, fullPage: true });

test("all product roles use real signed chain transactions and reload recovery", async ({
  page,
}) => {
  await installWallets(page, h.people);
  page.on("dialog", (dialog) => void dialog.accept());
  const errors: string[] = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error("Browser error:", e.message);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("Browser console:", msg.text());
  });
  await page.goto(UI);
  await loginAs(page, "Operator");
  await openConsole(page, "Operator");
  await transact(page, "Create USDC test mint");
  await expect(page.getByLabel("USDC test mint")).not.toHaveValue("");
  await transact(page, "Create USDT test mint");
  await expect(page.getByLabel("USDT test mint")).not.toHaveValue("");
  await transact(page, "Initialize platform");
  await page.getByText("Fund devnet test assets", { exact: true }).click();
  await page.getByLabel("Test token recipient").fill(h.people.Guest.address);
  await page.getByLabel("Test token amount").fill("100");
  await transact(page, "Send USDC test tokens");
  await transact(page, "Send USDT test tokens");
  for (const name of ["Bikes", "Camping"]) {
    await page.getByLabel("Merchant wallet address").fill(h.people[name].address);
    await page.getByLabel("Merchant name").fill(name);
    await transact(page, "Register merchant");
  }
  const shop = page.locator("article").filter({ hasText: "Bikes · Enabled" });
  await transact(page, "Pause new rentals", shop);
  await transact(
    page,
    "Resume new rentals",
    page.locator("article").filter({ hasText: "Bikes · Paused" }),
  );
  await shot(page, "operator");
  await loginAs(page, "Guest");
  await openConsole(page, "Guest");
  for (const asset of ["SOL", "USDC", "USDT"]) {
    await selectAsset(page, asset);
    await page
      .getByLabel(`Amount (${asset})`)
      .fill(asset === "SOL" ? "0.1" : "20");
    await transact(page, "Deposit");
  }
  for (const [asset, amount] of [
    ["SOL", "0.02"],
    ["USDC", "5"],
    ["USDT", "5"],
  ]) {
    const id = `normal-${asset}`;
    await authorizeRental(page, h, asset, id, amount);
    await loginAs(page, "Bikes");
    await openConsole(page, "Merchant");
    await transact(
      page,
      "Accept and lock deposit",
      page
        .locator("article")
        .filter({ hasText: id })
        .filter({ hasText: "Awaiting merchant" }),
    );
    if (asset === "SOL") {
      const contents = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=",
        "base64",
      );
      await page
        .getByLabel("Photo HTTPS URL (optional)")
        .fill("https://example.com/return.png");
      await page
        .getByLabel("Choose a photo to hash its actual file contents")
        .setInputFiles({
          name: "return.png",
          mimeType: "image/png",
          buffer: contents,
        });
      await expect(
        page.getByText(createHash("sha256").update(contents).digest("hex"), {
          exact: true,
        }),
      ).toBeVisible();
    }
    await transact(
      page,
      "Return in good condition",
      page
        .locator("article")
        .filter({ hasText: id })
        .filter({ hasText: "Active" }),
    );
    await loginAs(page, "Guest");
    await openConsole(page, "Guest");
    await page.reload();
    await expect(page.getByText(/On-chain state synced/)).toBeVisible();
    await selectAsset(page, asset);
    await page.getByLabel(`Amount (${asset})`).fill(amount);
    await transact(page, "Withdraw to wallet");
  }
  await authorizeRental(page, h, "USDC", "damage-test", "5");
  await shot(page, "guest");
  await loginAs(page, "Bikes");
  await openConsole(page, "Merchant");
  await transact(
    page,
    "Accept and lock deposit",
    page
      .locator("article")
      .filter({ hasText: "damage-test" })
      .filter({ hasText: "Awaiting merchant" }),
  );
  await transact(
    page,
    "Return damaged, freeze",
    page
      .locator("article")
      .filter({ hasText: "damage-test" })
      .filter({ hasText: "Active" }),
  );
  await shot(page, "merchant");
  await transact(
    page,
    "Confirm compensation, unfreeze",
    page
      .locator("article")
      .filter({ hasText: "damage-test" })
      .filter({ hasText: "Frozen" }),
  );
  await loginAs(page, "Guest");
  await openConsole(page, "Guest");
  await authorizeRental(page, h, "USDC", "keeper-test", "5");
  await loginAs(page, "Bikes");
  await openConsole(page, "Merchant");
  await transact(
    page,
    "Accept and lock deposit",
    page
      .locator("article")
      .filter({ hasText: "keeper-test" })
      .filter({ hasText: "Awaiting merchant" }),
  );
  const state = await loadSnapshot(makeRpc(h.net.rpcUrl));
  h.net.timeTravelToTimestamp(Number(state.timestamp + 180n * 86400n) * 1000);
  await loginAs(page, "Operator");
  await openConsole(page, "Keeper");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await shot(page, "keeper");
  await transact(page, "Release to available balance");
  await page
    .getByRole("button", { name: "Query this role's activity", exact: true })
    .click();
  await expect(
    page
      .locator(".panel")
      .filter({
        has: page.getByRole("heading", {
          name: "On-chain activity",
          exact: true,
        }),
      })
      .locator("article")
      .filter({ hasText: "Keeper release" }),
  ).toBeVisible();
  await loginAs(page, "Guest");
  await openConsole(page, "Guest");
  // User cancellation never signs or modifies state.
  page.removeAllListeners("dialog");
  page.once("dialog", (dialog) => void dialog.dismiss());
  const beforeCancel = (await loadSnapshot(makeRpc(h.net.rpcUrl))).deposits.find(
    (d) => d.data.owner === h.people.Guest.address && d.data.mint === p.ZERO,
  )!.data.available;
  await selectAsset(page, "SOL");
  await page.getByLabel("Amount (SOL)").fill("0.01");
  await page.getByRole("button", { name: "Deposit", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Cancelled");
  expect(
    (await loadSnapshot(makeRpc(h.net.rpcUrl))).deposits.find(
      (d) => d.data.owner === h.people.Guest.address && d.data.mint === p.ZERO,
    )!.data.available,
  ).toBe(beforeCancel);
  page.on("dialog", (dialog) => void dialog.accept());
  // Drop the RPC response after the validator executes the original transaction.
  let dropped = false;
  await page.route(h.net.rpcUrl, async (route) => {
    const body = route.request().postDataJSON();
    if (!dropped && body.method === "sendTransaction") {
      dropped = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Deposit", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Check transaction result", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Deposit", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Check transaction result", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Check transaction result", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Confirmed on chain");
  expect(
    (await loadSnapshot(makeRpc(h.net.rpcUrl))).deposits.find(
      (d) => d.data.owner === h.people.Guest.address && d.data.mint === p.ZERO,
    )!.data.available,
  ).toBe(beforeCancel + 10_000_000n);
  await page.unroute(h.net.rpcUrl);
  await page.getByRole("button", { name: "Query this role's activity" }).click();
  const historyPanel = page.locator(".panel").filter({
    has: page.getByRole("heading", { name: "On-chain activity", exact: true }),
  });
  await expect(
    historyPanel.locator("article").filter({ hasText: "Keeper release" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.screenshot({
    path: "../tests/product-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(
    (await loadSnapshot(makeRpc(h.net.rpcUrl))).rentals.filter(
      (r) => r.data.status === 0 || r.data.status === 2,
    ),
  ).toHaveLength(0);
});

/*
 * Routing tests.
 *
 * Each console owns one unique heading, so "the right console rendered" is a
 * checkable claim rather than a screenshot. The tests below run after the flow
 * above, in declaration order (workers: 1), and the wallet-landing case relies
 * on the merchants that flow registered.
 */
const CONSOLE_HEADINGS: Record<string, string> = {
  guest: "My deposit sub-accounts",
  merchant: "Return evidence",
  operator: "Platform and merchant management",
  keeper: "Rentals past 180 days",
};
const heading = (page: Page, text: string) =>
  page.getByRole("heading", { name: text, exact: true });

test("each console has its own deep link, and only that console renders", async ({
  page,
}) => {
  await installWallets(page, h.people);
  for (const [role, text] of Object.entries(CONSOLE_HEADINGS)) {
    await page.goto(`${UI}#/${role}`);
    await expect(heading(page, text)).toBeVisible();
    for (const [other, otherText] of Object.entries(CONSOLE_HEADINGS)) {
      if (other !== role) await expect(heading(page, otherText)).toHaveCount(0);
    }
    // The console in view is stated in the address bar, not just implied by the
    // active tab, so a link taken from a video description reproduces the view.
    await expect(page.locator(".hero-band .route")).toHaveText(`#/${role}`);
    await page.reload();
    await expect(page).toHaveURL(`${UI}#/${role}`);
    await expect(heading(page, text)).toBeVisible();
  }
  // A bare link lands on the end user's console rather than an empty shell.
  await page.goto(UI);
  await expect(page).toHaveURL(`${UI}#/guest`);
  await expect(heading(page, CONSOLE_HEADINGS.guest)).toBeVisible();
});

test("the connected wallet chooses the landing console", async ({ page }) => {
  await installWallets(page, h.people);
  await page.goto(UI);
  await expect(page).toHaveURL(`${UI}#/guest`);
  // Bikes is a registered merchant, so the merchant console is the better guess.
  await loginAs(page, "Bikes");
  await expect(page).toHaveURL(`${UI}#/merchant`);
  await expect(heading(page, CONSOLE_HEADINGS.merchant)).toBeVisible();
  // The operator wallet is the platform authority.
  await loginAs(page, "Operator");
  await expect(page).toHaveURL(`${UI}#/operator`);
  // A console the user opened by hand outranks the guess, and survives reload.
  await openConsole(page, "Keeper");
  await expect(page).toHaveURL(`${UI}#/keeper`);
  await page.reload();
  await expect(page).toHaveURL(`${UI}#/keeper`);
  await expect(heading(page, CONSOLE_HEADINGS.keeper)).toBeVisible();
});
