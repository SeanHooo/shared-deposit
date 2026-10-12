---
artifact: demo-script
version: "1.0"
created: 2026-10-12
status: ready
deadline: 2026-10-13T15:00+08:00
---

# Demo video — 3 minutes, shot list

Colosseum judges are English-speaking. **The UI is Chinese.** So narration and
on-screen English captions carry the meaning; do not rely on the reader to parse
the interface.

Record one continuous take if you can. A single unbroken run is more convincing
than cuts, and the flow is a single session anyway.

## Setup before recording

```bash
# 1. App running against devnet (or localnet, see RUNBOOK step 5)
cd app
VITE_SOLANA_RPC_URL=<working devnet RPC> npm run dev -- --host 127.0.0.1

# 2. Phantom with three accounts already imported/created:
#    Authority (CMNgjVq...)  -> operator
#    Guest                   -> the customer
#    Bikes, Camping          -> two merchants
# 3. Platform already initialized, two merchants registered, guest funded
#    (RUNBOOK step 2). Do NOT record the setup.
# 4. Browser at 1440x900, zoom 110%, no bookmarks bar, clean profile.
# 5. Pre-fill the guest wallet with 100 USDC (operator → `Fund devnet test assets`).
# 6. Do one silent rehearsal of the whole path.
```

Set the stage at the starting state: `Guest` account selected, **Guest** tab open,
20 USDC already deposited.

## Shot list

| # | Time | On screen (exact clicks) | English caption / narration |
| --- | --- | --- | --- |
| 1 | 0:00–0:20 | Title card, then the app with `Guest` connected, Guest tab | **"Renting four things in one day means paying four deposits. Four payments. Four refunds. Four waits."** — Problem, stated as the customer's cost |
| 2 | 0:20–0:35 | Gesture at the asset list showing `Available / Locked / Frozen / Withdrawable` balances | **"Shared Deposit Passport: one deposit, held by a Solana program, reusable at every merchant."** |
| 3 | 0:35–0:55 | → merchant `Bikes`, item `bike-42`, due date, click **Confirm single-use authorization** | **"The guest authorizes one rental, for one merchant, one amount, one item. Funds do not move yet — this is a signed authorization, valid for a single use."** Point out the confirmation summary text: it lists merchant, item, amount, due date |
| 4 | 0:55–1:15 | Switch Phantom to `Bikes`. **Merchant** tab. Click **Accept and lock deposit** | **"Only the merchant the guest named can act on it. The lock is the only point where funds move — from available to locked, inside the same passport."** |
| 5 | 1:15–1:35 | Still `Bikes`. **Return evidence**: paste an HTTPS photo URL, choose a file, hash appears. Click **Return in good condition** | **"Return evidence: the file's SHA-256 is computed in the browser. Nothing is uploaded — the chain stores the hash and the reference."** |
| 6 | 1:35–1:55 | Switch to `Guest`. Guest tab. Point at the balance: **20 USDC Available** | **"Deposit released, back to the guest's passport. Not to a merchant, not pending a refund."** |
| 7 | **1:55–2:20** | → merchant `Camping`, item `tent-7`, amount 5, click **Confirm single-use authorization** → switch to `Camping` → **Accept and lock deposit** → **Return in good condition** | **THE MONEY SHOT.** **"Same 20 USDC. Second merchant. No second deposit."** Add a lower-third: `0 USDC re-deposited`. Then switch back to `Guest` and hold on the balance |
| 8 | 2:20–2:35 | `Guest`. Click **Withdraw to wallet** | **"The guest withdraws whatever is not locked — one asset can be withdrawn while another is still locked behind a rental."** |
| 9 | 2:35–2:50 | Cut to `tests/acceptance.md` + the Playwright spec in an editor, then a still frame of the e2e run | **"This is not a happy-path prototype. Real SBF integration tests cover foreign mints, wrong signers, replayed nonces, revoked and expired authorizations, concurrent locks, and duplicate transitions. The 180-day keeper release is proven by time travel, not by waiting."** |
| 10 | 2:50–3:00 | Title card: problem / solution / program address / repo | **"Shared Deposit Passport. Pay a deposit once. Rent from every merchant."** |

## The three things that must land

If a judge remembers nothing else:

1. **The lock does not take the guest's money.** It moves an amount from available
   to locked *inside the guest's own account*. (Shots 3–4)
2. **The same deposit is reused at a second merchant with no re-deposit.** (Shot 7 —
   give it the most time)
3. **It is really on chain.** No backend, no demo mode, no mocked state. (Shot 9)

## Honest disclosures to make in the video

Say these plainly. They cost you nothing and buy credibility:

- **Devnet only, no real funds.**
- **The 180-day keeper is not demonstrated live** — it is proven in the local test
  suite with time travel. Devnet never bypasses the timer. Say this instead of
  faking it; shot 9 is where it belongs.
- **The operator and keeper consoles are internal tooling**, not customer product.
- If you end up recording against a local validator because the devnet RPC was
  unreachable, say so on screen. See RUNBOOK fallback step 5.

## Avoid

- Do not show the operator setup, mint creation or merchant registration. It is
  internal tooling and it eats your three minutes.
- Do not record a wallet signature rejection, an RPC error, or the network-error
  console message. (The e2e test deliberately produces one; the video should not.)
- Do not narrate in Chinese if the judges are English-speaking. Chinese UI is fine;
  English narration is not optional.
- Do not use a screen recording with system notifications enabled.
- Do not exceed 3:00. Colosseum submissions are skimmed first; a 3-minute cut that
  lands three points beats a 7-minute tour.

## Upload

- YouTube (unlisted or public) or Loom, 1080p, with English captions if the tool
  offers auto-generation — the UI is Chinese, so captions help.
- Title: `Shared Deposit Passport — pay a deposit once, rent from every merchant`
- Paste the link into the Colosseum form and into `README.md`.
