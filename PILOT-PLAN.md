---
artifact: pilot-roadmap
version: "1.0"
created: 2026-10-30
status: proposed
scope: post-mvp-closed-pilot
---

# Shared Deposit Pilot Roadmap

This is the working checklist for moving the verified MVP toward a closed pilot.
The initial pilot scope is deliberately narrow:

- One tourist-dense city or district.
- One rental category.
- One stablecoin asset.
- About five merchants and 20-50 test guests.
- No real funds until the trust, operations and mainnet gates are satisfied.

The Solana program remains the source of truth for balances and state. Indexing,
notifications, evidence storage and operator tooling are supporting services, not
new authorities over deposits.

## Current Baseline

- The MVP contains the guest, merchant, operator and keeper consoles, with real
  wallet-signed transactions and on-chain state.
- Local verification on 2026-10-30: `npm test` passed 32 tests and
  `npm run build` passed.
- The devnet status read timed out from the development environment on
  2026-10-30. This was not treated as evidence that the deployment is broken.
- [VERIFICATION.md](VERIFICATION.md) and [DEPLOYMENT.md](DEPLOYMENT.md) describe
  different points in the devnet acceptance history and must be reconciled.
- There are no live users, merchant commitments or revenue yet. The main
  product risk is whether guests reuse one passport at multiple merchants.

## P0: Baseline Closeout

Target: 2-3 days.

- [ ] Write a one-page pilot scope covering the district, rental category, asset,
  merchant count and excluded features.
- [ ] Reconcile [VERIFICATION.md](VERIFICATION.md) and
  [DEPLOYMENT.md](DEPLOYMENT.md) so both state what is locally verified and what
  has actually been accepted on devnet.
- [ ] Add CI that runs `npm test`, `npm run build` and the critical Playwright
  flow.
- [ ] Re-read devnet state and save the result, confirming the program, platform,
  merchants and test assets are still usable.
- [ ] Remove expired dates, stale video placeholders and obsolete submission
  instructions.
- [ ] Define pilot acceptance criteria for fund safety, transaction recovery,
  keeper alerting and customer support.

Exit criteria:

- One project status is agreed across all top-level documents.
- CI can detect a broken client or chain-client contract.
- The pilot boundary and success criteria fit on one page.

## P1: Operable MVP

Target: 1-2 weeks.

- [ ] Implement a persistent keeper that scans for rentals eligible for release.
- [ ] Make keeper submission idempotent, with retries, RPC failover, alerting and
  unknown-transaction recovery.
- [ ] Add an event indexer that records authorization, lock, return, release and
  freeze events in Postgres or Supabase.
- [ ] Document that indexed state is only a query model and that the chain remains
  the authority for funds and state transitions.
- [ ] Add a minimal operator console for merchant review, merchant suspension,
  abnormal rentals, frozen records and keeper health.
- [ ] Add evidence storage with signed uploads, SHA-256 verification, access
  control and a retention policy.
- [ ] Replace the merchant-hosted photo URL dependency with project-controlled
  evidence storage.
- [ ] Alert on unconfirmed transactions, rentals overdue for release, repeated
  keeper failures and RPC failures.
- [ ] Write a merchant onboarding runbook that a non-developer can follow through
  a first test rental.
- [ ] Add health checks and production build paths for the indexer and keeper.

Exit criteria:

- One merchant can be onboarded without a developer operating every step.
- An overdue rental can be released without a person clicking the keeper console.
- Operators can identify and recover a stuck or unknown transaction.

## P2: Closed Pilot

Target: 2 weeks.

- [ ] Recruit about five merchants in the same district and rental category.
- [ ] Run a role rehearsal with every merchant covering authorization, lock,
  return, freeze and compensation.
- [ ] Prepare 20-50 test guests and target at least 100 rental records.
- [ ] Instrument the funnel from wallet connection through first deposit,
  authorization, merchant acceptance, return and cross-merchant reuse.
- [ ] Build a pilot dashboard showing transaction success and rentals stuck for
  more than ten minutes.
- [ ] Provide a support entry point and a manual compensation process.
- [ ] Interview guests and merchants weekly and record rejected flows, failed
  actions and trust concerns.
- [ ] Run a continue, adjust or stop review at the end of the pilot.

Exit criteria:

- At least one guest reuses the same passport at two merchants within 24 hours.
- Normal returns restore available balance within 30 seconds.
- Authorization-to-lock success is above 95%.
- No unrecoverable stuck rental, duplicate release or loss of funds occurs.
- First-time merchant setup takes less than 15 minutes.

## P3: Trust And Security Hardening

Target: 2-3 weeks.

- [ ] Design a dispute state covering damage or loss evidence, guest confirmation,
  guest appeal and operator resolution.
- [ ] Attach merchant signatures, timestamps and content hashes to return evidence.
- [ ] Keep automatic deductions out of scope until the evidence supports a safe
  rule.
- [ ] Move platform operations to a multisig account.
- [ ] Move upgrade authority to an independent cold wallet and document the
  emergency upgrade process.
- [ ] Add a kill switch for new locks, abnormal-rental handling and an incident
  response plan.
- [ ] Run a focused security review of the program, client transaction
  construction and keeper.
- [ ] Exercise RPC outage, indexer lag, keeper downtime and duplicate-submission
  recovery.

Exit criteria:

- A damage claim no longer depends solely on one merchant's assertion.
- Operator and upgrade privileges have documented recovery paths.
- Incident response has been rehearsed rather than only written down.

## P4: Mainnet Readiness

Start only if P0-P3 show real cross-merchant reuse and acceptable operating risk.

- [ ] Complete a third-party smart contract audit and close all critical findings.
- [ ] Define stablecoin, account-freeze, privacy, merchant-agreement and
  compensation policies.
- [ ] Provide multiple RPC providers, a fee budget, highly available keepers and
  24-hour alerting.
- [ ] Benchmark transaction and account-rent costs for small deposits.
- [ ] Launch mainnet by invitation, with amount caps and a single-city canary.

## Explicitly Deferred

- [ ] Concurrent locks for one passport.
- [ ] Additional chains or assets beyond the pilot asset.
- [ ] Automatic deductions, penalties, interest or insurance.
- [ ] Fully self-service merchant onboarding.
- [ ] More on-chain instructions before pilot data proves they are needed.

## Related Documents

- [README.md](README.md): project overview and verified capabilities.
- [PITCH.md](PITCH.md): product thesis and next-step hypothesis.
- [PRD.md](PRD.md): v1 product requirements.
- [PLAN.md](PLAN.md): original implementation plan.
- [VERIFICATION.md](VERIFICATION.md): local and devnet verification evidence.
- [DEPLOYMENT.md](DEPLOYMENT.md): deployment record and addresses.
