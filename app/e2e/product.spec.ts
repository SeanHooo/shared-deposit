import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { Surfnet } from "@solana/surfpool";
import {
  createKeyPairSignerFromBytes,
  generateKeyPairSigner,
  getAddressEncoder,
  getBase64Encoder,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  type KeyPairSigner,
} from "@solana/kit";
import * as p from "../src/program";
import { loadSnapshot, makeRpc } from "../src/chain";

let net: Surfnet, server: ChildProcess;
let people: Record<string, KeyPairSigner>;
const ui = "http://127.0.0.1:5199";
test.beforeAll(async () => {
  net = Surfnet.startWithConfig({
    offline: true,
    blockProductionMode: "clock",
    slotTimeMs: 100,
  });
  people = {
    Operator: await createKeyPairSignerFromBytes(net.payerSecretKey),
    Guest: await generateKeyPairSigner(),
    Bikes: await generateKeyPairSigner(),
    Camping: await generateKeyPairSigner(),
  };
  for (const who of Object.values(people))
    net.fundSol(who.address, 20_000_000_000);
  net.deploy({
    programId: p.PROGRAM_ADDRESS,
    soPath: "../target/deploy/shared_deposit_passport.so",
  });
  const dataAddress = await p.programDataAddress();
  const info = (
    await makeRpc(net.rpcUrl)
      .getAccountInfo(dataAddress, { encoding: "base64" })
      .send()
  ).value!;
  const bytes = new Uint8Array(getBase64Encoder().encode(info.data[0]));
  bytes[12] = 1;
  bytes.set(getAddressEncoder().encode(people.Operator.address), 13);
  net.setAccount(dataAddress, Number(info.lamports), bytes, info.owner);
  server = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      "5199",
      "--strictPort",
    ],
    {
      env: {
        ...process.env,
        VITE_SOLANA_RPC_URL: net.rpcUrl,
        VITE_LOCALNET: "true",
      },
      stdio: "ignore",
    },
  );
  await expect
    .poll(async () => {
      try {
        return (await fetch(ui)).status;
      } catch {
        return 0;
      }
    })
    .toBe(200);
});
test.afterAll(() => {
  server?.kill();
  net?.stop();
});

async function installWallets(page: Page) {
  await page.exposeFunction(
    "syntheticSign",
    async (name: string, wire: number[]) => {
      const transaction = getTransactionDecoder().decode(new Uint8Array(wire));
      const signed = await partiallySignTransaction(
        [people[name].keyPair],
        transaction,
      );
      return Array.from(getTransactionEncoder().encode(signed));
    },
  );
  await page.addInitScript(
    (entries) => {
      const wallets = entries.map((entry) => {
        const account = {
          address: entry.address,
          publicKey: new Uint8Array(entry.publicKey),
          chains: ["solana:devnet"],
          features: ["solana:signTransaction"],
        };
        return {
          version: "1.0.0",
          name: entry.name,
          icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
          chains: ["solana:devnet"],
          accounts: [account],
          features: {
            "standard:connect": {
              version: "1.0.0",
              connect: async () => ({ accounts: [account] }),
            },
            "standard:disconnect": {
              version: "1.0.0",
              disconnect: async () => {},
            },
            "standard:events": { version: "1.0.0", on: () => () => {} },
            "solana:signTransaction": {
              version: "1.0.0",
              supportedTransactionVersions: [0],
              signTransaction: async (
                ...inputs: { transaction: Uint8Array }[]
              ) =>
                Promise.all(
                  inputs.map(async (input) => ({
                    signedTransaction: new Uint8Array(
                      await (
                        window as unknown as {
                          syntheticSign: (
                            n: string,
                            w: number[],
                          ) => Promise<number[]>;
                        }
                      ).syntheticSign(
                        entry.name,
                        Array.from(input.transaction),
                      ),
                    ),
                  })),
                ),
            },
          },
        };
      });
      const register = (api: {
        register: (...wallets: unknown[]) => unknown;
      }) => api.register(...wallets);
      window.addEventListener("wallet-standard:app-ready", (event) =>
        register((event as CustomEvent).detail),
      );
      window.dispatchEvent(
        new CustomEvent("wallet-standard:register-wallet", {
          detail: register,
        }),
      );
    },
    Object.entries(people).map(([name, who]) => ({
      name,
      address: who.address,
      publicKey: Array.from(getAddressEncoder().encode(who.address)),
    })),
  );
}
async function wallet(page: Page, name: string) {
  const disconnect = page.getByRole("button", { name: /^Disconnect/ });
  if (await disconnect.count()) await disconnect.click();
  await page.getByRole("button", { name: `Connect ${name}`, exact: true }).click();
  await expect(page.getByRole("button", { name: /^Disconnect/ })).toBeVisible();
  await expect(page.getByText(/On-chain state synced/)).toBeVisible();
}
async function transact(
  page: Page,
  label: string,
  root = page as Page | ReturnType<Page["locator"]>,
) {
  await root.getByRole("button", { name: label, exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Confirmed on chain", {
    timeout: 20000,
  });
}
async function auth(page: Page, asset: string, id: string, amount: string) {
  await page
    .getByRole("button", { name: new RegExp(`^${asset}.*Available`) })
    .click();
  await page.getByLabel(`Amount (${asset})`).fill(amount);
  await page.getByLabel("Merchant").selectOption({
    label: `Bikes · ${people.Bikes.address.slice(0, 6)}…${people.Bikes.address.slice(-5)}`,
  });
  await page.getByLabel("Item ID").fill(id);
  await page.getByLabel("Agreed return time").fill("2030-10-12T12:00");
  await transact(page, "Confirm single-use authorization");
}
test("all product roles use real signed chain transactions and reload recovery", async ({
  page,
}) => {
  await installWallets(page);
  page.on("dialog", (dialog) => void dialog.accept());
  const errors: string[] = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error("Browser error:", e.message);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("Browser console:", msg.text());
  });
  await page.goto(ui);
  await wallet(page, "Operator");
  await page.getByRole("button", { name: "Operator", exact: true }).click();
  await transact(page, "Create USDC test mint");
  await expect(page.getByLabel("USDC test mint")).not.toHaveValue("");
  await transact(page, "Create USDT test mint");
  await expect(page.getByLabel("USDT test mint")).not.toHaveValue("");
  await transact(page, "Initialize platform");
  await page.getByText("Fund devnet test assets", { exact: true }).click();
  await page.getByLabel("Test token recipient").fill(people.Guest.address);
  await page.getByLabel("Test token amount").fill("100");
  await transact(page, "Send USDC test tokens");
  await transact(page, "Send USDT test tokens");
  for (const name of ["Bikes", "Camping"]) {
    await page.getByLabel("Merchant wallet address").fill(people[name].address);
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
  await wallet(page, "Guest");
  await page.getByRole("button", { name: "Guest", exact: true }).click();
  for (const asset of ["SOL", "USDC", "USDT"]) {
    await page
      .getByRole("button", { name: new RegExp(`^${asset}.*Available`) })
      .click();
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
    await auth(page, asset, id, amount);
    await wallet(page, "Bikes");
    await page.getByRole("button", { name: "Merchant", exact: true }).click();
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
      await page.getByLabel("Choose a photo to hash its actual file contents").setInputFiles({
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
    await wallet(page, "Guest");
    await page.getByRole("button", { name: "Guest", exact: true }).click();
    await page.reload();
    await expect(page.getByText(/On-chain state synced/)).toBeVisible();
    await page
      .getByRole("button", { name: new RegExp(`^${asset}.*Available`) })
      .click();
    await page.getByLabel(`Amount (${asset})`).fill(amount);
    await transact(page, "Withdraw to wallet");
  }
  await auth(page, "USDC", "damage-test", "5");
  await wallet(page, "Bikes");
  await page.getByRole("button", { name: "Merchant", exact: true }).click();
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
  await wallet(page, "Guest");
  await page.getByRole("button", { name: "Guest", exact: true }).click();
  await auth(page, "USDC", "keeper-test", "5");
  await wallet(page, "Bikes");
  await page.getByRole("button", { name: "Merchant", exact: true }).click();
  await transact(
    page,
    "Accept and lock deposit",
    page
      .locator("article")
      .filter({ hasText: "keeper-test" })
      .filter({ hasText: "Awaiting merchant" }),
  );
  const state = await loadSnapshot(makeRpc(net.rpcUrl));
  net.timeTravelToTimestamp(Number(state.timestamp + 180n * 86400n) * 1000);
  await wallet(page, "Operator");
  await page.getByRole("button", { name: "Keeper", exact: true }).click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await transact(page, "Release to available balance");
  await page
    .getByRole("button", { name: "Query this role's activity", exact: true })
    .click();
  await expect(
    page
      .locator(".panel")
      .filter({
        has: page.getByRole("heading", { name: "On-chain activity", exact: true }),
      })
      .locator("article")
      .filter({ hasText: "Keeper release" }),
  ).toBeVisible();
  await wallet(page, "Guest");
  await page.getByRole("button", { name: "Guest", exact: true }).click();
  // User cancellation never signs or modifies state.
  page.removeAllListeners("dialog");
  page.once("dialog", (dialog) => void dialog.dismiss());
  const beforeCancel = (await loadSnapshot(makeRpc(net.rpcUrl))).deposits.find(
    (d) => d.data.owner === people.Guest.address && d.data.mint === p.ZERO,
  )!.data.available;
  await page.getByRole("button", { name: /^SOL.*Available/ }).click();
  await page.getByLabel("Amount (SOL)").fill("0.01");
  await page.getByRole("button", { name: "Deposit", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Cancelled");
  expect(
    (await loadSnapshot(makeRpc(net.rpcUrl))).deposits.find(
      (d) => d.data.owner === people.Guest.address && d.data.mint === p.ZERO,
    )!.data.available,
  ).toBe(beforeCancel);
  page.on("dialog", (dialog) => void dialog.accept());
  // Drop the RPC response after the validator executes the original transaction.
  let dropped = false;
  await page.route(net.rpcUrl, async (route) => {
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
  await page.getByRole("button", { name: "Check transaction result", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Confirmed on chain");
  expect(
    (await loadSnapshot(makeRpc(net.rpcUrl))).deposits.find(
      (d) => d.data.owner === people.Guest.address && d.data.mint === p.ZERO,
    )!.data.available,
  ).toBe(beforeCancel + 10_000_000n);
  await page.unroute(net.rpcUrl);
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
    (await loadSnapshot(makeRpc(net.rpcUrl))).rentals.filter(
      (r) => r.data.status === 0 || r.data.status === 2,
    ),
  ).toHaveLength(0);
});
