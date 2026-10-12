import { test, expect } from "@playwright/test";
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
