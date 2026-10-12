---
artifact: demo-script
version: "1.1"
created: 2026-10-12
status: ready
deadline: 2026-10-13T15:00+08:00
---

# Demo video — 3 minutes, shot list

The interface is in English, so a judge can read the screen. Narration still
carries the argument — do not make the video a silent click-through.

Record one continuous take if you can. A single unbroken run is more convincing
than cuts, and the flow is a single session anyway.

## Setup before recording

```bash
# 1. Open https://shared-passport.vercel.app in the browser you record with.
#    Record the deployed build, not a dev server. The address bar then shows the URL a
#    judge will open, and the take proves the artifact you actually submitted rather
#    than a variant of it. Connect the wallet on that origin, because a wallet
#    connection belongs to the origin it was made on.
#
#    Fallback, only if the host misbehaves: cd app && npm run dev
#    Do not "just rebuild" the way out of a problem here: see the stale-build check in
#    RUNBOOK Step 4, because a build that produces nothing looks the same as one that
#    worked.

# 2. Phantom switched to Devnet, with four accounts imported/created:
#    Authority (CMNgjVq...)  -> operator
#    Guest                   -> the customer
#    Bikes, Camping          -> two merchants
# 3. Platform already initialized, two merchants registered, guest funded with
#    100 USDC and 100 USDT (RUNBOOK step 2). Do NOT record the setup.
# 4. All four wallets hold devnet SOL: each role pays its own network fee, and a
#    wallet with 0 SOL fails at simulation, not with a funding message.
# 5. Browser at 1440x900, zoom 110%, no bookmarks bar, clean profile.
# 6. The silent rehearsal is done: every step below ran once against devnet on
#    2026-10-12 and the result is in VERIFICATION.md. It also confirmed that
#    switching Phantom's active account and clicking Disconnect then Connect does
#    update the address in the header band, which was the one thing that could not be
#    checked without a real extension.
```

Record the screen silently, then narrate over it, unless you are confident enough to
narrate live. A silent take plus a second pass is the version that fails gracefully:
you can re-word a sentence without re-performing the clicks, and the shot list gives you
timings to cut against. Do not ship a silent click-through — the argument is the part a
judge cannot get from the interface.

Set the stage at the starting state: `Guest` account selected, **Guest** console
open, 20 USDC already deposited. The header band shows `#/guest` — each console
has its own URL, so you can also navigate by editing the address bar if a tab
click misbehaves on camera.

## Shot list

| # | Time | On screen (exact clicks) | English caption / narration |
| --- | --- | --- | --- |
| 1 | 0:00–0:20 | Title card, then the app with `Guest` connected, Guest console | **"Renting four things in one day means paying four deposits. Four payments. Four refunds. Four waits."** — Problem, stated as the customer's cost |
| 2 | 0:20–0:35 | Gesture at the asset list showing `Available / Locked / Frozen / Withdrawable` balances, then at the header band with `On-chain state synced · slot N` and `#/guest` | **"Shared Deposit Passport: one deposit, held by a Solana program, reusable at every merchant."** |
| 3 | 0:35–0:55 | → merchant `Bikes`, item `bike-42`, due date, click **Confirm single-use authorization** | **"The guest authorizes one rental, for one merchant, one amount, one item. Funds do not move yet — this is a signed authorization, valid for a single use."** Point out the confirmation summary text: it lists merchant, item, amount, due date |
| 4 | 0:55–1:15 | Switch Phantom to `Bikes`. **Merchant** console. Click **Accept and lock deposit** | **"Only the merchant the guest named can act on it. The lock is the only point where funds move — from available to locked, inside the same passport."** |
| 5 | 1:15–1:35 | Still `Bikes`. **Return evidence**: paste an HTTPS photo URL, choose a file, hash appears. Click **Return in good condition** | **"Return evidence: the file's SHA-256 is computed in the browser. Nothing is uploaded — the chain stores the hash and the reference."** |
| 6 | 1:35–1:55 | Switch to `Guest`. Guest console. Point at the balance: **20 USDC Available** | **"Deposit released, back to the guest's passport. Not to a merchant, not pending a refund."** |
| 7 | **1:55–2:20** | → merchant `Camping`, item `tent-7`, amount 5, click **Confirm single-use authorization** → switch to `Camping` → **Accept and lock deposit** → paste the same evidence URL as shot 5 → **Return in good condition** | **THE MONEY SHOT.** **"Same 20 USDC. Second merchant. No second deposit."** Add a lower-third: `0 USDC re-deposited`. Then switch back to `Guest` and hold on the balance |
| 8 | 2:20–2:35 | `Guest`. Click **Withdraw to wallet** | **"The guest withdraws whatever is not locked — one asset can be withdrawn while another is still locked behind a rental."** |
| 9 | 2:35–2:50 | Cut to `app/e2e/product.spec.ts`, `app/e2e/harness.ts` and `VERIFICATION.md` in an editor, then a still frame of the e2e run | **"This is not a happy-path prototype. Real SBF integration tests cover foreign mints, wrong signers, replayed nonces, revoked and expired authorizations, concurrent locks, and duplicate transitions. The 180-day keeper release is proven by time travel, not by waiting."** The stills in `docs/screenshots/` are captured by that same run |
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
- Do not fight Phantom on camera. All accounts in one Phantom extension reach the
  page as a single wallet, so switching role means switching the active account in
  the extension **and** clicking Disconnect then Connect again. Confirm that this
  updates the address in the header band during the rehearsal; if it does not, use
  a separate browser profile per role instead. Do not discover this while recording.
- Do not rely on the wallet to pick the console. The wallet chooses a landing console
  only while you have not chosen one yourself; the moment you click a console tab,
  that choice is pinned and later account switches will not move you. Every role
  change in the shot list therefore means **switch the Phantom account, then click
  the console tab**. Two deliberate clicks, not one hopeful wait.
- Do not use a screen recording with system notifications enabled.
- Do not narrate an item ID other than the one on screen. `bike-42` and `tent-7` are
  arbitrary strings, so any value works — but a judgment call made live, out loud, is one
  more thing that can disagree with the screen. The rehearsal's Camping return left the
  evidence reference empty, which the program permits; the recording should paste the URL
  from shot 5 instead, so the two returns look alike.
- Do not exceed 3:00. Colosseum submissions are skimmed first; a 3-minute cut that
  lands three points beats a 7-minute tour.

## Upload

- YouTube (unlisted or public) or Loom, 1080p, with English captions if the tool
  offers auto-generation. The interface is English, so captions mostly help
  viewers watching muted, which is how a judge skims first.
- Title: `Shared Deposit Passport — pay a deposit once, rent from every merchant`
- Paste the link into the Colosseum form and into `README.md`.
