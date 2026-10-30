# Shared Deposit API

This package is the runnable backend baseline for the v2 contract. It exposes
wallet authentication, chain-authoritative participant data, dispute evidence
metadata, notifications, health checks, and an OpenAPI document.

The Solana program remains the sole authority for funds, balances, locks,
rental state, and dispute outcomes. The API reads that state and recomputes
wallet roles on protected requests. It never signs fund-moving transactions.

## Run locally

Install the Web dependencies first because the server imports the shared
generated v2 client from `app/src`.

```bash
cd app && npm ci
cd ../server && npm ci
npm run dev
```

Defaults:

- API: `http://127.0.0.1:8787`
- OpenAPI JSON: `http://127.0.0.1:8787/documentation/json`
- Swagger UI: `http://127.0.0.1:8787/docs`
- Cluster: `devnet`

Configure runtime values with environment variables such as
`SOLANA_RPC_URLS`, `SOLANA_CLUSTER`, `USDC_MINT`, `SIWS_DOMAIN`, `SIWS_URI`,
`JWT_SECRET`, and `KEEPER_ALLOWLIST`. Never put a wallet secret key or seed
phrase in this package.

## Safety behavior

- SIWS challenges are server-owned, one-time, and expire.
- Wallet signatures are verified with Ed25519.
- Access tokens last 15 minutes by default.
- Refresh tokens are hashed, rotated, and revoke their family on reuse.
- Roles are recomputed from chain on every protected request.
- RPC URLs are pinned by cluster genesis hash; localnet requires loopback.
- Multiple RPC endpoints are tried in order without turning the API into a
  second source of truth.
- Evidence uploads register metadata only after the wallet identifies a
  visible rental. Duplicate rental/digest pairs are rejected.
- Notification reads are scoped to the authenticated wallet.

## Verification

```bash
npm run build
npm test
```

## Current limits

This is not a production deployment. Persistence is in memory and disappears
when the process restarts. Supabase/Postgres adapters, an event indexer,
reconciliation jobs, a persistent keeper, push delivery, private object
upload, EXIF removal, malware scanning, 365-day retention automation,
Sentry, and background audit-log storage are not implemented here.

The evidence endpoints store metadata and digests, not evidence bodies. Do not
describe them as private object storage until the storage adapter and its
security controls exist. The API also does not implement the planned Squads
2-of-3 mainnet authority or invitation-only production gate.
