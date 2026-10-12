---
artifact: edge-cases
version: "1.1"
created: 2026-10-11
status: implemented-local
---

# Edge Cases: Shared Deposit Passport

## Feature Overview

PRD v1 scope: three assets, a single global lock per passport, single-use
authorizations, merchant returns, freeze and unfreeze, the 180-day keeper release,
and wallet transaction recovery.
Related Documents: [PRD](../PRD.md), [acceptance criteria](acceptance.md),
[plan](../PLAN.md).

## Edge Case Categories

### Input Validation

| Scenario | Expected Behavior | Priority | Notes |
| --- | --- | --- | --- |
| Amount empty, zero, negative, scientific notation, over-precise, or above u64 | Reject, do not sign | P1 | 6 decimals for USDC/USDT, 9 for SOL; integer ledger |
| Item or merchant name empty or over 64 bytes | Reject, allow edit | P1 | Counted as UTF-8 bytes |
| Invalid wallet, unregistered mint or merchant | Reject, allow correction | P1 | A same-named token cannot stand in for an allowlisted mint |
| Return time not in the future, stale nonce, or rule version other than 1 | Reject the authorization | P1 | The nonce comes from chain |
| Photo URL not HTTPS, or over 256 bytes | Reject, allow correction | P2 | An empty URL with a zero hash means none supplied; the hash is of file contents |

### Boundary Conditions

| Scenario | Expected Behavior | Priority | Notes |
| --- | --- | --- | --- |
| Exactly the minimum balance left after locking | Allow | P1 | 1 USDC/USDT, 0.01 SOL |
| One native unit below the minimum | Reject | P1 | No rounding |
| Authorization at one year, or past the agreed return time | Reject acceptance | P1 | Revocation still works |
| Locked for under 180 days, or exactly 180 days | Reject the former, allow the keeper on the latter | P1 | Measured from `started_at` |
| Frozen beyond 180 days | Do not release automatically | P1 | Only the original merchant unfreezes, after confirming compensation |
| Withdraw an asset balance to zero | Allow, keeping the account rent | P1 | Only while nothing is locked or frozen |

### Error States

| Scenario | Expected Behavior | Priority | Notes |
| --- | --- | --- | --- |
| Program not deployed, or platform not initialized | Show the setup step, disable the matching writes | P1 | Never simulate success |
| RPC is not devnet | Block fund operations | P1 | Locally only an explicit loopback is accepted |
| Wallet refuses to sign, simulation fails, or the wallet cannot pay the network fee | Show the error, allow edit and retry | P1 | A transaction that was never submitted does not change displayed balances |
| Operator or merchant permission error | Rejected on chain | P1 | The original merchant can still handle rentals started before a pause |

### Concurrency

| Scenario | Expected Behavior | Priority | Notes |
| --- | --- | --- | --- |
| Double submit | The action lock and disabled buttons prevent a second signature | P1 | An unknown result blocks new writes |
| Two merchants racing to lock | Only one succeeds | P1 | The global passport lock |
| Repeated accept, return, unfreeze, or keeper call | Reject, funds unchanged | P1 | Terminal states cannot be released again |
| Withdrawal after authorizing, leaving too little | Balance is re-checked when the merchant accepts | P1 | An authorization does not reserve funds |
| Top up or withdraw a locked asset | Reject; another unlocked asset may still be withdrawn | P1 | A freeze counts as an unresolved global lock too |
| Page reload or wallet switch | Re-read from chain, clear history and photo input | P1 | Never reuse the previous wallet's in-memory balances |

### Integration Failures

| Scenario | Expected Behavior | Priority | Notes |
| --- | --- | --- | --- |
| RPC read failure or rate limit | State explicitly unsynced, disable writes, allow refresh | P1 | A stale balance is never presented as current |
| Network drops after send, or the response is lost | Save the signature and the signed transaction, then decide by querying | P1 | Resend the same bytes; never rebuild |
| blockhash expired and the chain has no record of execution | Clear pending, allow a fresh attempt | P1 | Decided using the finalized block height |
| External photo unreachable | Chain still holds the status, time, reference and hash | P2 | v1 makes no photo-hosting guarantee |

## Error Messages

| Error State | User Message | Additional Action |
| --- | --- | --- |
| RPC failure | Read failed, money operations are paused | Refresh |
| Unknown transaction result | Previous transaction result unconfirmed | Check result / resend the same transaction |
| Bad amount | Enter a positive amount / at most N decimal places | Edit the amount |
| Simulation failed | Simulation failed, showing the program error | Edit the input, or refresh state |
| Role not registered | This wallet is not a registered merchant | Switch wallet, or have the operator register it |

## Recovery Paths

### Unknown transaction result

User sees: the saved signature and an unconfirmed notice.

Recovery options: query the original signature; resend the same transaction while
it is still valid; only create a new one once it is confirmed failed or expired
without having executed.

Data preservation: localStorage holds the signature, the signed transaction bytes,
the wallet, the summary and the validity block height — never a private key. Chain
state is always authoritative.

### Wallet / RPC error

User sees: a wallet error, or state that is not synced.

Recovery options: connect the right wallet, point at a working devnet RPC, refresh,
or fix the input.

Data preservation: confirmed state stays on chain; unconfirmed money movements are
never written into a local balance.

## Test Scenarios

### Must Test (P1)

- [x] SBF: three assets, unauthorized access, revocation, concurrent locks, withdrawing a different asset, repeated operations, damage/missing freezes, compensation, expiry, and the 180-day boundary.
- [x] Browser: wallet switching, reload recovery, hashing a real photo file, cancelling a signature, query recovery after a lost send response, and no horizontal overflow at 390px.
- [ ] Real devnet manual acceptance across three assets and two merchants, after deployment.

### Should Test (P2)

- [ ] Access and retention policy for real merchant photo service links (external dependency).

### Nice to Test (P3)

- [ ] Production network capacity and mainnet wallet compatibility (out of v1 scope).
