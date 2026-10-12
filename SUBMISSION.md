---
artifact: submission-kit
version: "1.0"
created: 2026-10-12
status: paste-ready
deadline: 2026-10-13T15:00+08:00
---

# Colosseum submission kit

Paste-ready copy for the submission form and the video description. The form's
exact field names vary, so each block is written to stand alone. Fill every
`YOUR-...` placeholder before submitting, and **submit by 12:00** — not 14:30.

## Fill these in first

| Placeholder | Where it comes from |
| --- | --- |
| `YOUR-VIDEO-URL` | Step 5 of [RUNBOOK-DEPLOY.md](RUNBOOK-DEPLOY.md) |
| Team / country / contact | yourself |

The live demo URL and the repository URL are already written into both blocks below:
`https://shared-passport.vercel.app` and `https://github.com/SeanHooo/shared-deposit`.
The deployed bundle was fetched and its bytes matched the locally verified build, so it
is not a link that merely resolves — it is the code described in
[VERIFICATION.md](VERIFICATION.md).

**Push the repository before you submit.** The URL is written down, and an unpushed
commit makes that line the broken link instead of the demo.

---

## Project name

Shared Deposit Passport

## Elevator pitch (one line, ~15 words)

Pay a deposit once. Rent from every merchant. A reusable on-chain deposit
passport, reusable the moment you return.

## Short description (~60 words)

Short-term rentals make the deposit the friction, not the rental: rent from four
vendors in one day and you pay four deposits, file four refund requests, and wait
days for each. Shared Deposit Passport puts one deposit in a Solana program. Each
merchant can lock only what the guest signs for that one rental, and returning
releases it straight back — ready for the next merchant.

## Long description (~250 words)

**The problem.** Bike, locker, camping-gear and power-bank rentals all share the
same shape, and the same tax on the customer. The deposit is re-implemented by
every merchant and paid separately by every customer. Four rentals in one day
means four payments, four refund requests, four waits. Merchants carry the mirror
cost: manual refunds, chargeback exposure, and staff time spent administering
deposits instead of renting.

**What we built.** One deposit account per guest, held by a Solana program and
reusable across the whole merchant allowlist. The flow is
`deposit once → authorize per rental → merchant locks → return → released,
reusable`. The guest signs a single-use authorization naming one merchant, one
item, one amount and one due time; no funds move at that point. Only that named
merchant can turn the authorization into a lock, and it can lock only the
authorized amount. A return releases the funds back to the passport, where they
are immediately spendable at the next merchant — no re-deposit, no refund wait.
The guest can withdraw any unlocked asset at any time.

**Trust boundaries.** Funds never reach the merchant; a merchant can only lock.
The guest's money stays in the program until the guest withdraws it. Damage or a
missing item freezes the amount instead of deducting it, and only the original
merchant can unfreeze after confirming compensation. A rental left untouched for
180 days can be released by anyone — a keeper cannot touch deposits, and a frozen
rental never times out.

## How it works (technical, ~120 words)

A Rust/Anchor program with 16 instructions and 6 PDA-derived account types:
`Platform` holds the merchant allowlist and the two accepted SPL mints;
`DepositPassport` is one per guest; `DepositAccount` is one per asset
sub-account and tracks available, locked and frozen balances; `Merchant`;
`MerchantAuthorization` is the guest's single-use, merchant-bound, nonce-guarded
permission; `RentalLock` is the per-rental state machine. Three assets are
supported: SOL plus USDC and USDT classic SPL mints. Every transition emits a
`PassportEvent` audit event. The client is React with `@solana/kit` and Wallet
Standard, so signing is a normal wallet signature and there is no backend, no
database and no indexer in the trust path — the program is the only authority.

## Built with

Rust, Anchor, Solana, SPL Token, PDAs, `@solana/kit`, Wallet Standard, Codama,
TypeScript, React, Vite, Playwright, Surfpool

## What's novel (three bullets)

- **The deposit is a wallet-held, merchant-agnostic balance.** Not a pre-auth on
  a card, not a merchant-held balance — a balance the customer owns and can
  spend at any merchant in the network.
- **Authorization without movement.** A guest authorization reserves nothing and
  moves nothing. Funds move only at the lock, which is the single point where a
  merchant gains any power, and only over the amount the guest named.
- **A shared rule set, defined once.** Minimum balance, freeze-on-damage, the
  180-day keeper release and frozen-never-times-out are program rules honored by
  every merchant instead of every merchant's policy page.

## Verification (the differentiator — most entries only run the happy path)

- **Real SBF integration tests**, not mocks: 10 tests pass, including 7 grouped
  scenarios against the compiled program. They reject foreign mints, wrong
  signers, revoked and expired authorizations, nonce replays, bound-account
  substitution, concurrent locks, duplicate transitions and premature keeper
  calls, and they confirm a frozen rental does not release at 180 days.
- **Browser tests drive the real UI with real Wallet Standard signatures**: 3
  tests cover all four consoles, the full money loop, reload recovery and
  console routing.
- **Failure paths are tested on purpose.** The suite drops an RPC response
  *after* the validator has executed the transaction, then asserts that the UI
  blocks new writes, survives a reload, resolves the saved signature, and that
  the balance increased **exactly once**. A genesis check blocks money
  operations unless the RPC is genuinely devnet.
- **The 180-day rule is proven by time travel** on a local validator. Devnet
  cannot be time-travelled, so this is disclosed rather than faked.

Current results: [VERIFICATION.md](VERIFICATION.md). Reproduce with
`cd app && npm install && npm test && npm run test:e2e` — no keys and no network
required; the suite starts its own validator and deploys the compiled program.

## Honest status

Working end-to-end MVP on Solana devnet. **No live users, no merchant letters of
intent, no revenue, and no real party operating the keeper or dispute path yet.**
This is a hackathon build with unusually thorough verification.

## What's next

1. One tourist-dense district, 5–10 merchants, one rental category — prove a
   guest reuses the passport at two or more merchants in a single trip.
2. Merchant-signed return photos and dispute resolution, so a damage claim is not
   one party's word.
3. A multi-sig operator and merchant self-onboarding, so the network can grow
   without us registering every merchant.

## Links block

```
Live demo (devnet):  https://shared-passport.vercel.app
Demo video (3 min):  YOUR-VIDEO-URL
Repository:          https://github.com/SeanHooo/shared-deposit
Program:             Bw5pP788g5eK117b7oA1dzSMg4N5ZG5vjcHpEKTzzN2o
Network:             Solana devnet — no real funds
```

---

# Video description (paste into the video's description field)

**Shared Deposit Passport — pay a deposit once, rent from every merchant.**

Rent four things in one day and you pay four deposits, file four refund requests
and wait days for each. This is one deposit, held by a Solana program, that any
merchant in the network can draw from — with a single-use authorization the guest
signs for that one rental. Returning releases the money back to the passport, so
the same deposit is spendable at the next merchant. No re-deposit, no refund wait.

Built for Colosseum. Devnet only.

Chapters
00:00 The problem: four rentals, four deposits
00:20 One passport, one deposit
00:35 The guest authorizes one rental
00:55 The merchant locks it
01:15 Return evidence
01:35 Released, and back on the passport
01:55 **The same deposit, a second merchant — no new deposit**
02:20 Withdraw
02:35 What is verified, and what is not yet real

Links
Live demo: https://shared-passport.vercel.app
Code: https://github.com/SeanHooo/shared-deposit
Program: Bw5pP788g5eK117b7oA1dzSMg4N5ZG5vjcHpEKTzzN2o
Verification: see VERIFICATION.md

Disclosures
- The 180-day keeper release is proven by time travel in the automated suite, not
  on camera: devnet cannot be time-travelled. It is not faked.
- No live users, no merchant commitments, no revenue yet.

---

## Final pre-submission checklist

- [ ] Live link loads and a wallet can connect on devnet (test in a private window)
- [ ] Video is uploaded, public or unlisted-but-linkable, and plays without login
- [ ] Every `YOUR-...` placeholder is replaced in the form **and** in `README.md`
- [ ] Repository is pushed, and `git status` shows no keypair, `.env` or `.so`
- [ ] Form submitted **before 12:00**, with hours to spare
- [ ] `README.md`, `PITCH.md` and `VERIFICATION.md` are readable by a judge who
      knows nothing about the project
