---
artifact: acceptance-criteria
version: "1.2"
created: 2026-10-11
status: implemented-local
---

# Acceptance Criteria: Shared Deposit Passport MVP

These scenarios are the implementation handoff derived from `PRD.md` and the edge-case catalog in `RESEARCH.md`.

## Story Context

Supports PRD FR-1 through FR-14. All state is read from the program. v1 is
devnet-only. A normal return releases funds back to the passport balance; the
guest withdraws to their own wallet separately. Authorization and merchant
acceptance are two independently signed transactions.

## Happy Path

- Given a devnet wallet and an allowlisted asset, when the guest initializes and deposits, then the matching subaccount shows the deposited amount as `Available`.
- Given an enabled merchant and sufficient balance, when the guest confirms merchant, asset, item, amount, due date, nonce and rules version, then a single-use authorization valid for one year is recorded without moving funds.
- Given a valid guest authorization, when its bound merchant accepts with its own wallet, then exactly one rental becomes active and the bound amount moves to locked.
- Given an active lock, when the merchant submits `ReturnedGood`, then the lock becomes terminal and its amount returns to the asset subaccount's `Available` balance.
- Given no lock or freeze on a subaccount, when the guest withdraws, then the requested amount reaches the guest wallet and the program balance decreases by the same amount.

## Edge Cases

- Given an existing global active lock, when another merchant attempts a lock, then the transaction fails without changing the first lock or any balance.
- Given a lock that would leave less than 1 USDC, 1 USDT or 0.01 SOL, when the guest signs it, then the transaction fails with a minimum-balance error.
- Given a USDC lock, when the guest withdraws from an unlocked USDT or SOL subaccount, then that withdrawal succeeds and the USDC lock remains unchanged.
- Given `ReturnedDamaged` or `Missing`, when the merchant submits the state, then the amount becomes `Frozen`, no amount is deducted, and the 180-day keeper path is rejected.
- Given a frozen lock, when the merchant confirms compensation, then the amount returns to `Available` and can later be withdrawn.
- Given an active lock older than 180 days with no return/freeze state, when any keeper submits release, then the amount returns to `Available` and the keeper cannot take deposit funds.
- Given a pending authorization, when the guest revokes it, then merchant acceptance fails without balance changes.
- Given a used, expired or differently bound authorization, when a merchant tries to accept it, then acceptance fails without balance changes.

## Error States

- Given a transaction timeout, when the user recovers, then the client first queries the saved original signature and only resends the same signed bytes while valid.
- Given an unavailable or wrong-cluster RPC, when the page reads state, then it shows an unsynchronized error and disables writes until a successful refresh.
- Given a successful simulation, when the user cancels the review or wallet signing, then no transaction is sent and balances remain unchanged.
- Given a missing program or platform, when the page opens, then it shows the corresponding setup step without a fabricated success.

## Non-Functional Criteria

- Given a deposit, authorization, revocation, lock, return, release, freeze, compensation or withdrawal, when the relevant wallet queries activity, then confirmed events include actor, amount, asset, subject and timestamp.
- Given return evidence, when the merchant submits it, then the rental retains status, timestamp, item and optional HTTPS photo reference/content hash without storing the photo original on-chain.
- Given a confirmed operation, when the page reloads or changes wallets, then it displays the relevant wallet's persisted state from chain.
- Given a wallet action, when signing is requested, then a successful simulation and review of amount, destination, cluster and payer precede it.

## Notes

Automated local coverage: `app/tests/chain.test.ts`, `app/e2e/product.spec.ts`. Local results do not imply devnet acceptance. No photo-hosting service, background keeper or account-rent refund is included.
