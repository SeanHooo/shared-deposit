# Shared Deposit Implementation Status

Updated 2026-10-30. This file separates working code from the broader release
roadmap so tests and demos are not mistaken for a mainnet launch.

## Implemented and locally verified

- Anchor v2 program with USDC-only deposits, 50 USDC rental cap, 100 USDC
  passport cap, six rental states, full-outcome disputes, evidence digests,
  and permissionless timeout release to the guest.
- Committed v2 IDL and deterministic Codama TypeScript client generation.
- Shared Kit client loaders used by both Web and the API, with owner,
  discriminator, mint, and expected-cluster checks.
- Surfpool v2 integration coverage for caps, authorization, locks, returns,
  both dispute outcomes, duplicate resolution, and keeper timing.
- Fastify API baseline with one-time SIWS challenges, Ed25519 verification,
  rotating refresh tokens, chain-derived roles, RPC failover, evidence
  metadata authorization, notification isolation, OpenAPI, and health output.
- CI definitions for Web, API, Rust, pinned Anchor build, IDL/client drift,
  and the Surfpool v2 suite.

## Partial

- Phase 1: the IDL/API/cluster contracts and CI baseline exist. An Android
  MWA transaction proof, iOS read-only pairing proof, and real-device
  pre-production rental are still required.
- Phase 2: the v2 contract and focused integration tests exist. It is not
  deployed to devnet. Property/fuzz coverage, a third-party audit, and the
  full malicious-input matrix remain open.
- Phase 3: the API baseline exists, but production Postgres/Supabase
  persistence, private object storage, indexing, reconciliation, persistent
  keeper, push notifications, Sentry, and operational audit retention are not
  connected.
- Web: the v2 Kit client loader is integrated into tests and API modules. The
  existing React UI still targets the v1 demo contract; the v2 route-based UI,
  SIWS session integration, and persistent write-ahead transaction log remain
  to be migrated.

## Not started

- Flutter Android transaction app and iOS read-only companion.
- Squads 2-of-3 mainnet authority and KMS-backed keeper.
- Store assets, legal review, privacy policy, support/dispute SLA, TestFlight,
  Play internal testing, hosted staging, and release rollback drills.
- Devnet v2 deployment, closed Singapore pilot, audit closure, invitation
  system, and mainnet release.

The 28-32 week launch plan is therefore not complete. The repository currently
contains a tested v2 contract and backend baseline, not a production service.
