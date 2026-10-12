# Shared Deposit Passport

**Pay a deposit once. Rent from every merchant.**

A single on-chain deposit passport: a guest deposits once, then any allowlisted
merchant can lock an amount the guest explicitly authorized for that specific
rental. On return the funds are released back to the passport and are immediately
reusable at the next merchant — no re-depositing, no refund wait.

> Built for **Colosseum**. Solana devnet only. No real funds.

| | |
| --- | --- |
| **Live demo (devnet)** | https://YOUR-DEMO-URL — connect a wallet switched to devnet |
| **Demo video (3 min)** | https://YOUR-VIDEO-URL |
| **Program** | `Bw5pP788g5eK117b7oA1dzSMg4N5ZG5vjcHpEKTzzN2o` |
| **Network** | Solana devnet |
| **License** | MIT |

## The problem

A traveller renting from four vendors in one day pays four deposits. Each one is a
separate payment, a separate refund request and a separate wait. Merchants pay the
same cost from the other side: manual refunds, disputes, and staff time spent
administering deposits instead of renting.

The deposit is a trust primitive. Today every merchant re-implements it badly, and
the customer pays for the duplication with their cash flow.

## What it does

```mermaid
flowchart LR
  G["Guest wallet"] -->|"1 deposit"| A["DepositAccount<br/>SOL / USDC / USDT"]
  A -->|"2 guest signs<br/>single-use authorization"| AU["MerchantAuthorization<br/>no funds move"]
  AU -->|"3 merchant accepts,<br/>locks the amount"| L["RentalLock<br/>Available to Locked"]
  L -->|"4 normal return"| A
  A -->|"5 SAME deposit<br/>reused at merchant B"| B["Merchant B"]
  L -->|"damaged or missing"| F["Frozen<br/>no deduction"]
  F -->|"merchant confirms<br/>compensation"| A
  L -->|"180 days idle"| K["keeper releases<br/>no penalty"]
  K --> A
```

The guest's funds never leave the program until the guest withdraws them. The
merchant never custodies the deposit: it can only lock an amount the guest
authorized, under the rules the program enforces.

## Architecture

```mermaid
flowchart TB
  subgraph Client["app/ — Vite + React 19 + TypeScript"]
    UI["Role consoles<br/>guest / merchant / operator / keeper"]
    KIT["@solana/kit + Wallet Standard"]
    GEN["src/generated — Codama client from the Anchor IDL"]
  end
  subgraph Chain["programs/shared-deposit-passport — Anchor, Rust"]
    IX["16 instructions"]
    ACC["6 account types, PDA derived"]
    EV["PassportEvent audit events"]
  end
  subgraph Tests["Verification"]
    SBF["Real SBF integration tests + time travel"]
    E2E["Playwright + real Wallet Standard signatures"]
  end
  UI --> KIT --> GEN --> IX --> ACC --> EV
  SBF -.-> IX
  E2E -.-> UI
```

There is **no backend, no database, no indexer and no demo mode**. Every balance,
authorization, rental and audit row is read from the chain. Refresh re-reads
persisted state from RPC.

## Try it in 30 seconds

1. Open the live link, switch your wallet to **devnet**.
2. Connect. The page reads the platform, merchants and your balances directly.
3. Pick an asset, deposit, choose a merchant, set an item and a return time,
   confirm the authorization.
4. Switch to the merchant wallet. Accept and lock the deposit.
5. Return the item. The amount is released back to your passport — and is now
   spendable at the second merchant without depositing again.

Step 5 is the whole product.

## Roles

| Role | Can do |
| --- | --- |
| **Guest** | Deposit SOL/USDC/USDT, authorize one rental, revoke an unused authorization, withdraw unlocked funds |
| **Merchant** | Accept and lock a guest-authorized amount, submit return evidence, freeze on damage/missing, unfreeze after compensation |
| **Operator** | Initialize the platform, allowlist merchants, pause/resume a merchant |
| **Keeper** | Release a rental that stayed active and untouched for 180 days. Never touches deposits |

## Why this is not a mock

Most hackathon contracts are only exercised through a happy-path script. This one
is verified against the **actual compiled SBF program**:

| Verification | What it proves |
| --- | --- |
| Real SBF integration tests | 16 instructions, 6 account types, three assets (SOL/USDC/USDT) end to end |
| Negative-path suite | Foreign mints, wrong signers, revoked/expired authorizations, nonce replay, bound-account substitution, concurrent locks, duplicate transitions, premature keeper calls |
| Time travel | The 180-day keeper rule, without bypassing the timer |
| Frozen-state rule | Frozen rentals do **not** auto-release at 180 days; only the original merchant can unfreeze after compensation |
| Wallet-signed browser E2E | Full four-role flow with real Wallet Standard signatures, not mocked state |
| Deliberate RPC failure | The response is dropped *after* the validator executed. The UI blocks new writes, survives a reload, and resolves the saved signature. The balance increases exactly once |
| Genesis check | Funds operations are blocked unless the RPC is genuinely devnet |

Test commands and current results: [VERIFICATION.md](VERIFICATION.md).
Acceptance scenarios: [tests/acceptance.md](tests/acceptance.md).
Failure surface: [tests/edge-cases.md](tests/edge-cases.md).

## Scope

**In v1:** three assets, one global lock per passport, single-use authorizations,
merchant return states, freeze/unfreeze, 180-day keeper release, unsigned
withdrawal to the guest wallet, full audit trail.

**Deliberately out:** mainnet, real funds, fiat on-ramp, custody, interest,
automated deductions, damage arbitration, insurance, multi-chain. Each is a scope
decision, not an unfinished item.

**Not yet operated:** the 180-day keeper and the dispute path are implemented and
tested, but no real party runs them yet.

---

# Developer guide

## Project layout

- `programs/shared-deposit-passport/`: Anchor program and account/state machine.
- `app/`: Vite + React client using Solana Kit and Wallet Standard.
- `tests/acceptance.md`: Given/When/Then acceptance scenarios.
- `RESEARCH.md`, `PRD.md`, `PLAN.md`: product and implementation sources of truth.

## Client

```bash
cd app
npm install
npm run dev
```

Set `VITE_SOLANA_RPC_URL` to use a custom devnet RPC. The client never targets mainnet.

## Program

The Anchor workspace requires Rust, Solana CLI, Anchor CLI and a devnet wallet. Once installed:

```bash
bash scripts/build.sh
```

Never commit wallet keypairs, seed phrases, or devnet secrets.

The build script explicitly uses SBF platform-tools v1.57 (Rust/Cargo 1.95).
The Solana CLI's default v1.48 tools cannot parse the current dependencies'
edition 2024 manifests. The script builds the program and Anchor IDL locally;
it does not deploy or send transactions.

## Generate, verify and run

```bash
bash scripts/build.sh
cd app
npm install
npm run generate
npm run build
npm test
npx playwright install chromium
npm run test:e2e
npm run dev -- --host 127.0.0.1
```

Integration tests use the real compiled SBF program, actual synthetic signatures,
SPL transfers and time travel in offline Surfpool. Browser tests launch their own
local RPC and Vite server, register synthetic Wallet Standard wallets and exercise
actual UI transactions. These test wallets are never included in the product.

The page has guest, merchant, operator and keeper consoles. Balances, pending
authorizations, rentals and audit events are read directly from the chain; there
is no demo mode, backend, database or account indexer. Refresh retrieves persisted
state. Every write is simulated and reviewed before wallet signing. When a result
is uncertain, query or resend the saved transaction instead of creating another.

## Devnet setup and walkthrough

Program: `Bw5pP788g5eK117b7oA1dzSMg4N5ZG5vjcHpEKTzzN2o`.

1. Fund the deployment authority wallet with devnet SOL. Check exact rent using
   `node scripts/deployment-check.mjs <PUBLIC_WALLET_ADDRESS>`.
2. Review and execute `NO_DNA=1 solana program deploy --url devnet target/deploy/shared_deposit_passport.so`.
   The CLI must use the intended deployment wallet; never copy its keypair into this project.
3. The **Operator** console can create two different six-decimal classic SPL test mints
   using wallet signing. Existing approved devnet test mints also work. These
   are project test assets, not redeemable USDC/USDT.
4. Set the public devnet RPC in `app/.env` if necessary; default is devnet.
   `VITE_LOCALNET=true` is accepted only on a loopback RPC URL. The program address
   comes from the generated client; mint addresses come from the platform account.
5. In the browser connect the deployment authority wallet. Under **Operator**, initialize
   the platform with the two mint addresses and register two merchant public keys.
   Open `Fund devnet test assets` to mint test tokens to the guest wallet; the current
   wallet must be the mint authority. The operator pays the receiving ATA rent.
6. Connect the guest wallet. Deposit SOL/USDC/USDT, choose an enabled merchant,
   item, amount and due time, then confirm the single-use authorization.
7. Connect that merchant wallet. Accept the guest authorization and lock funds.
   Confirm normal return to release funds into the program balance. Alternatively,
   record damage/missing and later confirm compensation to unfreeze without deduction.
8. Switch back to the guest. Reuse the deposit at the second merchant or withdraw
   to the guest wallet. An unlocked asset may withdraw while another is locked.
9. Any connected wallet can release ACTIVE rentals after 180 days from locking.
   FROZEN rentals cannot time out. The invoking wallet pays fees; no keeper fee
   comes from deposits. Local tests time-travel; devnet never bypasses the timer.

Selecting a photo computes SHA-256 from file content. The merchant supplies an
external HTTPS photo link; originals are not uploaded or stored by this app.
Account rent remains in program state accounts; withdrawal moves deposit funds,
not account rent. Historical state accounts are retained for auditability.

Devnet acceptance is separate from local test success. A funded deployment wallet,
two test mints, and real connected browser wallets are required to finish it.

## Documents

- [PITCH.md](PITCH.md) — problem, model, market, roadmap
- [VERIFICATION.md](VERIFICATION.md) — what is verified, with evidence
- [DEPLOYMENT.md](DEPLOYMENT.md) — devnet deployment details
- [RUNBOOK-DEPLOY.md](RUNBOOK-DEPLOY.md) — step-by-step deploy and initialize runbook
- [DEMO-SCRIPT.md](DEMO-SCRIPT.md) — three-minute demo shot list
- [tests/acceptance.md](tests/acceptance.md), [tests/edge-cases.md](tests/edge-cases.md)
- [PRD.md](PRD.md), [RESEARCH.md](RESEARCH.md), [PLAN.md](PLAN.md)
