/*
 * Smoke-test the deployed build in a real browser, in front of the URL a judge will open.
 *
 * Everything else in this directory runs against a local validator and synthetic wallets,
 * which proves the code but not the deployment: a wrong asset path, a missing header or a
 * bundle that throws on load all pass those tests and fail here. Skipped unless DEMO_URL
 * is set, so the suite stays offline by default.
 *
 *   DEMO_URL=https://shared-deposit.vercel.app npm run test:e2e
 *
 * The addresses below are this deployment's fixed values, recorded in DEPLOYMENT.md. They
 * are pinned on purpose: if the demo is ever redeployed with a fresh platform, these
 * checks should fail until someone looks at what changed, because a smoke test that
 * passes against any deployment is not checking this one.
 */
import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { generateKeyPairSigner } from "@solana/kit";
import { installWallets, loginAs, openConsole, programArtifact } from "./harness";
import * as p from "../src/program";

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

test("the artifact in the repository is the program devnet is running", async ({
  page,
}) => {
  // The suite claims its browser tests exercise the program that is deployed. That claim is
  // checkable rather than a promise: the cluster holds the bytes, so anyone can hash them
  // and compare. It is the difference between "the tests pass" and "the tests pass against
  // the code you can call", and it is cheap enough to assert on every run.
  const local = programArtifact();
  const programData = await p.programDataAddress();

  await page.goto(demoUrl!, { waitUntil: "load" });
  const remote = await page.evaluate(async (address: string) => {
    const response = await fetch("https://api.devnet.solana.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [address, { encoding: "base64" }],
      }),
    });
    const data = (await response.json()).result.value.data[0];
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    // A ProgramData account is a fixed header followed by the ELF file itself.
    const elf = bytes.subarray(45);
    const digest = await crypto.subtle.digest("SHA-256", elf);
    return {
      magic: String.fromCharCode(...elf.subarray(0, 4)),
      sha256: [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
    };
  }, programData);

  expect(remote.magic).toBe("\x7fELF");
  expect(
    remote.sha256,
    `${local.path} differs from the program at ${programData}`,
  ).toBe(local.sha256);
});

test("the deployed bundle is the one this repository builds", async ({ page }) => {
  // The failure this guards against is silent, and it happened twice while preparing this
  // submission: `npm run build` succeeds, `dist/` keeps the timestamps it already had, and
  // the hosted site serves an earlier afternoon's interface - once including a confirmation
  // dialog that named a merchant's identity address as the transaction's signer. Nothing
  // warns, and the page loads perfectly. Comparing digests is the only form of this check
  // that a page which merely renders cannot satisfy.
  test.skip(
    !existsSync("dist/index.html"),
    "no local build to compare against - run: VITE_SOLANA_RPC_URL=https://api.devnet.solana.com npm run build",
  );
  const html = readFileSync("dist/index.html", "utf8");
  const bundle = /src="([^"]+\.js)"/.exec(html)?.[1];
  expect(bundle, "dist/index.html names no script").toBeTruthy();
  const local = createHash("sha256")
    .update(readFileSync(`dist${bundle}`))
    .digest("hex");

  await page.goto(demoUrl!, { waitUntil: "load" });
  const remote = await page.evaluate(async (path: string) => {
    const response = await fetch(path);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      await response.arrayBuffer(),
    );
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }, bundle!);

  expect(
    remote,
    `${demoUrl} is not serving dist${bundle}. Rebuild, redeploy, or check that this URL is not an older deployment.`,
  ).toBe(local);
});
