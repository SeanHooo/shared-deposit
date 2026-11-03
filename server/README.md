# Shared Deposit API

This package is the runnable backend baseline for the v2 contract. It exposes
wallet authentication, chain-authoritative participant data, dispute evidence
metadata, notifications, health checks, an OpenAPI document, and a separately
run chain event indexer with full-snapshot reconciliation.

The Solana program remains the sole authority for funds, balances, locks,
rental state, and dispute outcomes. The API reads that state and recomputes
wallet roles on protected requests. Indexed events and account projections are
for history, audit, operations, and health only; they do not replace those
chain-authoritative API reads. The API never signs fund-moving transactions.

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
- Storage: in-memory when `DATABASE_URL` is unset; PostgreSQL otherwise

Configure runtime values with environment variables such as
`SOLANA_RPC_URLS`, `SOLANA_CLUSTER`, `USDC_MINT`, `SIWS_DOMAIN`, `SIWS_URI`,
`JWT_SECRET`, `KEEPER_ALLOWLIST`, and `DATABASE_URL`. Never put a wallet secret
key or seed phrase in this package.

## PostgreSQL

Production requires `DATABASE_URL`. Apply the versioned schema before starting
the API:

```bash
DATABASE_URL='postgresql://user:password@host:5432/shared_deposit' npm run db:migrate
DATABASE_URL='postgresql://user:password@host:5432/shared_deposit' npm run dev
```

The API checks `schema_migrations` at startup and refuses to run against a
database where the runtime migrations have not been applied. The connection
pool is closed when Fastify shuts down. Do not log the connection string.

The schema persists:

- one-time SIWS challenges;
- hashed, rotating refresh tokens and their token families;
- evidence metadata and digests;
- notifications and read state;
- authentication and evidence audit records;
- chain event history, complete account projections, event and reconciliation
  cursors, reconciliation runs, and changed/removed account findings.

The opaque refresh token is returned to the client but only its SHA-256 hash is
stored. Refresh rotation and reuse revocation happen in one database
transaction.

## Chain indexer and reconciliation

Run the indexer as its own long-lived process after applying migrations:

```bash
DATABASE_URL='postgresql://user:password@host:5432/shared_deposit' npm run indexer
```

Each cycle reads a complete v2 `getProgramAccounts` snapshot first and
reconciles it against `chain_account_projection`. It then reads program
signatures newer than the persisted event cursor, reads each transaction with
`maxSupportedTransactionVersion: 1` and `encoding: "base64"`, validates the
generated v2 event discriminator and program log stack, and stores the event
batch. A PostgreSQL row lock serializes cursor updates; the event rows and
cursor advance commit in the same transaction.

The cursor does not advance when transaction retrieval or event validation
fails. A stored cursor that has fallen outside the RPC provider's retained
history is treated as a hard gap, not silently skipped. Failed Solana
transactions advance the cursor without inserting events because their logs are
not committed chain state.

If the configured program is undeployed or the platform account is absent from
the RPC snapshot, the cycle fails before reconciliation. Existing projections
and the last validated observation slot are retained instead of being cleared
by an incomplete response.

`GET /v1/health` reports `starting`, `healthy`, or `degraded` for the indexer.
It degrades when the last successful cycle is older than
`INDEXER_STALE_AFTER_SECONDS`, when the event-scan checkpoint falls more than
`INDEXER_MAX_LAG_SLOTS` behind the validated account snapshot, or when the
latest error has not been cleared by a successful cycle. The scan checkpoint
is independent of the last event transaction, so periods without program
events remain healthy. A cycle capped by
`INDEXER_MAX_TRANSACTIONS_PER_CYCLE` leaves the checkpoint at the last
processed transaction until the backlog is cleared. In a production
deployment, a configured database with no indexer attempt reports
`degraded`; run exactly one indexer process per cluster/program pair and page
on this status.

## Safety behavior

- SIWS challenges are server-owned, one-time, and expire.
- Wallet signatures are verified with Ed25519.
- Access tokens last 15 minutes by default.
- Refresh tokens are hashed, rotated, and revoke their family on reuse.
- PostgreSQL persists challenges, refresh-token families, evidence metadata,
  notifications, and audit records across API restarts.
- Roles are recomputed from chain on every protected request.
- RPC URLs are pinned by cluster genesis hash; localnet requires loopback.
- Multiple RPC endpoints are tried in order without turning the API into a
  second source of truth.
- Indexer transaction and block reads opt in to transaction v1. Program logs
  and RPC responses are validated before any event is stored.
- Event replay is idempotent, and account reconciliation records added,
  updated, and removed projections with hashes and run audit records.
- Evidence uploads register metadata only after the wallet identifies a
  visible rental. Duplicate rental/digest pairs are rejected.
- Notification reads are scoped to the authenticated wallet.

## Verification

```bash
npm run build
npm test
```

## Current limits

This is not a production deployment. The PostgreSQL adapter has been verified
against an in-process PostgreSQL-compatible engine, not a live Supabase project.
The indexer has not yet run continuously against a hosted PostgreSQL instance,
an operational RPC provider, and the devnet v2 history. A persistent keeper,
push delivery, private object upload, EXIF removal, malware scanning, 365-day
retention automation, Sentry, and operator tooling for audit-log access are not
implemented here.

The evidence endpoints store metadata and digests, not evidence bodies. Do not
describe them as private object storage until the storage adapter and its
security controls exist. The API also does not implement the planned Squads
2-of-3 mainnet authority or invitation-only production gate.
