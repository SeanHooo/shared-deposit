/**
 * Shared end-to-end harness.
 *
 * Everything in this module is *driving* infrastructure: starting a validator,
 * deploying the program, injecting Wallet Standard wallets, switching wallets
 * and clicking transactions. It contains no assertions about the product.
 *
 * Keeping it separate means a new spec file (per role, per app, per flow) can
 * reuse the environment without duplicating the validator, the program deploy
 * or the wallet injection. Without this split, every spec re-implements the
 * setup and the copies drift apart.
 */
import { expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
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
import { makeRpc } from "../src/chain";

export type People = Record<string, KeyPairSigner>;

/** Concurrency is 1 and the port is strict, so specs never collide. */
export const UI = "http://127.0.0.1:5199";
export const PROGRAM_DATA_AUTHORITY_OFFSET = { active: 12, authority: 13 };

export type Harness = {
  net: Surfnet;
  people: People;
  /** Stop the dev server and the validator. */
  stop: () => void;
};

/** Formats an address the way the UI does, for building select-option labels. */
export const shortAddress = (value: string) =>
  `${value.slice(0, 6)}…${value.slice(-5)}`;

/**
 * Boots an offline validator, deploys the compiled SBF program, makes the
 * configured payer the upgrade authority, spawns Vite against that validator,
 * and waits for the page to answer.
 */
export async function startHarness(): Promise<Harness> {
  const net = Surfnet.startWithConfig({
    offline: true,
    blockProductionMode: "clock",
    slotTimeMs: 100,
  });
  const people: People = {
    Operator: await createKeyPairSignerFromBytes(net.payerSecretKey),
    Guest: await generateKeyPairSigner(),
    Bikes: await generateKeyPairSigner(),
    Camping: await generateKeyPairSigner(),
  };
  for (const who of Object.values(people)) net.fundSol(who.address, 20_000_000_000);
  net.deploy({
    programId: p.PROGRAM_ADDRESS,
    soPath: "../target/deploy/shared_deposit_passport.so",
  });
  // Mark the ProgramData account upgraded and point its pending authority at
  // the operator, so initializePlatform can be called from the browser.
  const dataAddress = await p.programDataAddress();
  const info = (
    await makeRpc(net.rpcUrl)
      .getAccountInfo(dataAddress, { encoding: "base64" })
      .send()
  ).value!;
  const bytes = new Uint8Array(getBase64Encoder().encode(info.data[0]));
  bytes[PROGRAM_DATA_AUTHORITY_OFFSET.active] = 1;
  bytes.set(
    getAddressEncoder().encode(people.Operator.address),
    PROGRAM_DATA_AUTHORITY_OFFSET.authority,
  );
  net.setAccount(dataAddress, Number(info.lamports), bytes, info.owner);

  const server: ChildProcess = spawn(
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
      env: { ...process.env, VITE_SOLANA_RPC_URL: net.rpcUrl, VITE_LOCALNET: "true" },
      stdio: "ignore",
    },
  );
  await expect
    .poll(async () => {
      try {
        return (await fetch(UI)).status;
      } catch {
        return 0;
      }
    })
    .toBe(200);

  return {
    net,
    people,
    stop: () => {
      server?.kill();
      net?.stop();
    },
  };
}

/**
 * Registers one Wallet Standard wallet per signer. Signing is delegated to the
 * test process, so every transaction the UI sends is really signed — there is
 * no mocked chain state.
 */
export async function installWallets(page: Page, people: People) {
  await page.exposeFunction("syntheticSign", async (name: string, wire: number[]) => {
    const transaction = getTransactionDecoder().decode(new Uint8Array(wire));
    const signed = await partiallySignTransaction(
      [people[name].keyPair],
      transaction,
    );
    return Array.from(getTransactionEncoder().encode(signed));
  });
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
              signTransaction: async (...inputs: { transaction: Uint8Array }[]) =>
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
                      ).syntheticSign(entry.name, Array.from(input.transaction)),
                    ),
                  })),
                ),
            },
          },
        };
      });
      const register = (api: { register: (...wallets: unknown[]) => unknown }) =>
        api.register(...wallets);
      window.addEventListener("wallet-standard:app-ready", (event) =>
        register((event as CustomEvent).detail),
      );
      window.dispatchEvent(
        new CustomEvent("wallet-standard:register-wallet", { detail: register }),
      );
    },
    Object.entries(people).map(([name, who]) => ({
      name,
      address: who.address,
      publicKey: Array.from(getAddressEncoder().encode(who.address)),
    })),
  );
}

/** Connects the named wallet and waits until chain state is confirmed fresh. */
export async function loginAs(page: Page, name: string) {
  const disconnect = page.getByRole("button", { name: /^Disconnect/ });
  if (await disconnect.count()) await disconnect.click();
  await page.getByRole("button", { name: `Connect ${name}`, exact: true }).click();
  await expect(page.getByRole("button", { name: /^Disconnect/ })).toBeVisible();
  await expect(page.getByText(/On-chain state synced/)).toBeVisible();
}

/** Selects a role console by its tab label. */
export async function openConsole(page: Page, role: string) {
  await page.getByRole("button", { name: role, exact: true }).click();
}

/** Clicks a transaction button and waits for on-chain confirmation. */
export async function transact(
  page: Page,
  label: string,
  root = page as Page | ReturnType<Page["locator"]>,
) {
  await root.getByRole("button", { name: label, exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Confirmed on chain", {
    timeout: 20000,
  });
}

/** Fills and submits the guest's single-use authorization form. */
export async function authorizeRental(
  page: Page,
  harness: Harness,
  asset: string,
  itemId: string,
  amount: string,
  merchant = "Bikes",
) {
  await selectAsset(page, asset);
  await page.getByLabel(`Amount (${asset})`).fill(amount);
  await page.getByLabel("Merchant").selectOption({
    label: `${merchant} · ${shortAddress(harness.people[merchant].address)}`,
  });
  await page.getByLabel("Item ID").fill(itemId);
  await page.getByLabel("Agreed return time").fill("2030-10-12T12:00");
  await transact(page, "Confirm single-use authorization");
}

/** Selects one of the three asset sub-account rows. */
export async function selectAsset(page: Page, asset: string) {
  await page.getByRole("button", { name: new RegExp(`^${asset}.*Available`) }).click();
}

export { expect, p };
