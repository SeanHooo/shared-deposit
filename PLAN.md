# Shared Deposit Passport Implementation Plan

## Skills

- `solana-dev`: Anchor program, Solana accounts, Wallet Standard, Kit transactions, devnet and Surfpool testing.
- `deliver-acceptance-criteria`: convert PRD requirements into pass/fail implementation checks.
- `deliver-edge-cases`: cover concurrent locks, timeouts, frozen deposits, RPC failures and duplicate submissions.

## Technical Choices

- Anchor 0.31.1 CLI / 0.31.2 crates + Rust for the on-chain program and IDL, matching the installed toolchain; SBF tools v1.57 for edition-2024 dependencies.
- Vite/React/TypeScript with `@solana/kit` 8, `@solana/react`, and Wallet Standard for the client.
- SPL Token vaults for USDC/USDT and a program-controlled lamport vault for SOL.
- Direct devnet RPC and PDA/event reads; no backend, database, or persistent keeper service.
- Browser/CLI keeper action for the 180-day release; no mainnet or real funds.
- Photos are supplied as an HTTPS URL and optionally a selected file; SHA-256 hashes the file contents, never the URL. No upload service in v1.
- Each rental has a separate guest-signed authorization PDA, then a merchant-signed acceptance/lock. No simultaneous wallet signatures are required.
- Return status, timestamps and photo evidence are retained inside RentalLock rather than a separate ReturnRecord account.
- Platform initialization requires the program upgrade authority; merchant management requires the recorded operator.
- Pending transaction signature and signed wire bytes are saved before sending; query or resend the same bytes after an uncertain result.

## Implementation Order

1. Initialize a fresh Anchor workspace and React/Vite client; configure devnet and allowlisted test assets.
2. Implement Passport, per-asset DepositAccount, Merchant, MerchantAuthorization, RentalLock, and ReturnRecord accounts.
3. Implement deposit, withdraw, merchant registration, authorization, revoke, lock, return, freeze, compensation unlock, and 180-day keeper release instructions.
4. Add the minimum client flows for guest, merchant, operator, and keeper roles.
5. Add event/state queries, transaction simulation, retry handling, and explicit Available/Locked/Frozen/Withdrawable states.

## Verification

- Anchor build and real SBF integration tests with embedded offline Surfpool; synthetic signers only.
- Playwright browser tests with Wallet Standard synthetic test wallets sign real transactions against that SBF program.
- Surfpool integration tests with time travel for the 180-day rule.
- Test three assets, concurrent-lock rejection, minimum balances, revoked/expired authorization, frozen states, unlocked-asset withdrawals, duplicate submissions, and RPC timeouts.
- Manual devnet smoke test with one guest, two merchants, and one operator/keeper wallet.

## Preparation

- Rust, Solana CLI, Anchor CLI and Surfpool installed.
- Devnet-only guest, merchant and operator public keys/wallets.
- Devnet USDC/USDT test mint addresses, or permission to create project-specific test mints.
- Never provide or commit private keys or seed phrases.
