/**
 * The loop, clicked by a person instead of asserted by a machine.
 *
 * This file contains no assertions and no timeouts, on purpose. It boots the same
 * in-process validator and deploys the same artifact the automated suite does, injects one
 * Wallet Standard wallet per role, opens the application in a visible browser, prints what
 * to click, and waits for the window to close. Every transaction performed in it is really
 * signed against a really running program - there is no mocked chain state anywhere.
 *
 *   npm run demo
 *
 * The point is that a reader does not have to take our word for the loop, or hold a funded
 * devnet wallet, to operate it: one command, no keys, nothing spent, and a browser they can
 * drive themselves.
 */
import { test } from "@playwright/test";
import { installWallets, startHarness, UI, type Harness } from "../e2e/harness";

const line = "=".repeat(78);

/** What to click, in order, with the addresses this run actually uses. */
function instructions(h: Harness) {
  const at = (name: string) => h.people[name].address;
  console.log(`
${line}
  The whole loop, by hand - one deposit, two merchants, one customer
${line}
  A browser window is opening at ${UI}

  The header will say LOCALNET. This is an in-process validator, not devnet: nothing is
  spent, no wallet is needed, and every transaction below is really signed and really
  executed by the program that is deployed on devnet.

  Four wallets are already in the browser. To change role:
      click "Disconnect" at the top right, then "Connect Guest" / "Connect Bikes" / ...

  Paste-ready addresses
      Guest             ${at("Guest")}
      Bikes  (merchant) ${at("Bikes")}
      Camping (merchant) ${at("Camping")}

  PART 1 - what the operator does once
      Connect Operator, open the Operator console.
        1. Create USDC test mint
        2. Create USDT test mint
        3. Initialize platform
        4. Click "Fund devnet test assets"
             Test token recipient = ${at("Guest")}
             Test token amount    = 100
             Send USDC test tokens, then Send USDT test tokens
        5. Register merchant - twice
             Merchant name           = Bikes          (then Camping)
             Merchant wallet address = ${at("Bikes")}   (then ${at("Camping")})
             Register merchant

  PART 2 - the customer's loop
      Connect Guest, open the Guest console.
        6. Tick the USDC row, Amount (USDC) = 20, click Deposit
             One click creates the passport, the deposit account and the deposit, and the
             transaction signature they all share says so.
        7. Rent from Bikes
             Amount (USDC) = 5, Merchant = Bikes, Item ID = bike-42,
             Agreed return time = 2030-01-01T12:00
             Confirm single-use authorization
        8. Connect Bikes, Merchant console, Accept and lock deposit on that request
             Photo HTTPS URL (optional) = https://example.com/receipt.jpg
             Return in good condition
        9. One deposit, two merchants: as Guest authorize another 5 USDC for Camping
           (Item ID = tent-7), lock it as Camping, return it in good condition. The second
           merchant was paid from the same balance, and neither could have spent it twice.
       10. Try to break it: as Guest authorize 100 USDC. It is refused, because the
           available balance is a chain fact and not a form validation. Then authorize 5
           for Bikes and, as the merchant, Return damaged, freeze, then
           Confirm compensation, unfreeze. The guest's balance drops - that is what the
           deposit was for.
       11. As Guest: tick the USDC row, Amount (USDC) = 5, Withdraw to wallet

  The 180-day keeper path is not reachable here: it needs time to pass, which is why it is
  covered by the automated suite with a clock it can move.

  Anything can be repeated, and a reload is safe - the state is on the validator, not in the
  page. Close this browser window when you are done, and the validator stops.
${line}
`);
}

test("click through the whole loop yourself", async ({ page }) => {
  test.setTimeout(0);
  const h = await startHarness();
  try {
    await installWallets(page, h.people);
    // Playwright dismisses dialogs unless told otherwise, and every transaction in this
    // application asks for confirmation first. Dismissing cancels the signature, which
    // would look exactly like a broken button.
    page.on("dialog", (dialog) => void dialog.accept());
    // Failures belong on the terminal beside the window, not only in the page.
    page.on("pageerror", (error) => console.error("[page error]", error.message));
    page.on("console", (message) => {
      if (message.type() === "error") console.error("[console error]", message.text());
    });

    await page.goto(UI);
    instructions(h);
    await page.waitForEvent("close", { timeout: 0 }).catch(() => {});
    console.log("\nWindow closed. Stopping the validator.\n");
  } finally {
    h.stop();
  }
});
