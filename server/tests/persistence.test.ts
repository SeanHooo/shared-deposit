import { readFile } from "node:fs/promises";
import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { getBase58Decoder } from "@solana/kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PROGRAM_ADDRESS_V2 } from "../../app/src/program-v2.js";
import { AuthService } from "../src/auth.js";
import { projectSnapshotAccounts } from "../src/indexer-types.js";
import { PostgresStore } from "../src/postgres.js";
import {
  snapshotFor,
  syntheticWallet,
  testConfig,
  type SyntheticWallet,
} from "./fixtures.js";

describe("PostgreSQL runtime persistence", () => {
  let pool: Pool;
  let store: PostgresStore;
  let wallet: SyntheticWallet;
  let auth: AuthService;

  beforeAll(async () => {
    const database = newDb();
    const adapter = database.adapters.createPg();
    pool = new adapter.Pool() as unknown as Pool;
    const runtimeMigration = await readFile(
      new URL("../migrations/001_runtime_persistence.sql", import.meta.url),
      "utf8",
    );
    const indexerMigration = await readFile(
      new URL("../migrations/002_chain_indexer.sql", import.meta.url),
      "utf8",
    );
    await pool.query(runtimeMigration);
    // pg-mem does not implement PostgreSQL's POSIX regex operator.
    await pool.query(
      indexerMigration.replaceAll(" ~ '^[0-9a-f]{64}$'", " <> ''"),
    );
    await pool.query(
      `CREATE TABLE schema_migrations (
         name TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
       )`,
    );
    await pool.query(
      "INSERT INTO schema_migrations (name) VALUES ($1), ($2)",
      ["001_runtime_persistence.sql", "002_chain_indexer.sql"],
    );
    store = new PostgresStore(pool);
    wallet = await syntheticWallet();
    auth = authService(store);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("keeps a SIWS challenge and issued session across service instances", async () => {
    await expect(store.assertMigrated()).resolves.toBeUndefined();
    const challenge = await auth.challenge(wallet.wallet);
    const restartedAuth = authService(store);
    await restartedAuth.consumeChallenge({
      challengeId: challenge.challengeId,
      wallet: wallet.wallet,
      signature: await wallet.sign(challenge.message),
    });

    await expect(
      restartedAuth.consumeChallenge({
        challengeId: challenge.challengeId,
        wallet: wallet.wallet,
        signature: await wallet.sign(challenge.message),
      }),
    ).rejects.toThrow("unknown or used");

    const tokens = await restartedAuth.issueTokens(wallet.wallet);
    const anotherProcess = authService(store);
    await expect(
      anotherProcess.verifyAccessToken(tokens.accessToken),
    ).resolves.toBe(wallet.wallet);

    const rotated = await anotherProcess.rotateRefresh(tokens.refreshToken);
    await expect(
      anotherProcess.rotateRefresh(tokens.refreshToken),
    ).rejects.toThrow("already used");
    await expect(
      anotherProcess.rotateRefresh(rotated.refreshToken),
    ).rejects.toThrow("already used");
  });

  it("persists evidence, notifications, and audit records", async () => {
    const rental = "11111111111111111111111111111111";
    const digest = "ab".repeat(32);
    const evidence = await store.addEvidence({
      rental,
      evidenceDigest: digest,
      objectKey: `rentals/${rental}/damage-photo.jpg`,
      contentType: "image/jpeg",
      sizeBytes: 64_000,
      uploadedBy: wallet.wallet,
    });
    expect(await store.evidenceByDigest(rental, digest)).toEqual(evidence);

    const notificationId = "0e4ac83b-b35c-4fc4-8cf8-7a8e73208f2d";
    await pool.query(
      `INSERT INTO notifications (
         id, wallet, kind, title, body, rental
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        notificationId,
        wallet.wallet,
        "rental",
        "Rental due soon",
        "Return the kayak before the due time.",
        rental,
      ],
    );
    expect(await store.notifications(wallet.wallet)).toHaveLength(1);
    expect(
      await store.markNotificationRead(wallet.wallet, notificationId),
    ).toMatchObject({ id: notificationId });
    expect(
      await store.markNotificationRead("11111111111111111111111111111111", notificationId),
    ).toBeNull();

    await store.audit({
      actor: wallet.wallet,
      action: "evidence.registered",
      subject: rental,
    });
    const audits = await pool.query(
      `SELECT actor, action, subject
       FROM audit_logs
       WHERE actor = $1`,
      [wallet.wallet],
    );
    expect(audits.rows).toEqual([
      {
        actor: wallet.wallet,
        action: "evidence.registered",
        subject: rental,
      },
    ]);
  });

  it("persists reconciliation runs and applies the complete chain snapshot", async () => {
    const merchant = await syntheticWallet();
    const operator = await syntheticWallet();
    const snapshot = await snapshotFor(
      wallet.wallet,
      merchant.wallet,
      operator.wallet,
    );
    const first = await store.reconcileSnapshot({
      cluster: "localnet",
      programId: PROGRAM_ADDRESS_V2,
      snapshotSlot: snapshot.slot.toString(),
      accounts: projectSnapshotAccounts(snapshot),
    });
    expect(first).toMatchObject({
      inserted: 4,
      updated: 0,
      deleted: 0,
      unchanged: 0,
    });

    const second = await store.reconcileSnapshot({
      cluster: "localnet",
      programId: PROGRAM_ADDRESS_V2,
      snapshotSlot: (snapshot.slot + 1n).toString(),
      accounts: projectSnapshotAccounts(snapshot),
    });
    expect(second).toMatchObject({
      inserted: 0,
      updated: 0,
      deleted: 0,
      unchanged: 4,
    });

    const projections = await pool.query(
      `SELECT account_kind, observed_slot
       FROM chain_account_projection
       WHERE cluster = $1 AND program_id = $2
       ORDER BY account_kind`,
      ["localnet", PROGRAM_ADDRESS_V2],
    );
    expect(projections.rows).toHaveLength(4);
    expect(
      projections.rows.every(
        (row) =>
          String(row.observed_slot) === (snapshot.slot + 1n).toString(),
      ),
    ).toBe(true);

    const runs = await pool.query(
      `SELECT status, inserted_count, unchanged_count
       FROM chain_reconciliation_runs
       ORDER BY started_at`,
    );
    expect(runs.rows).toEqual([
      { status: "completed", inserted_count: 4, unchanged_count: 0 },
      { status: "completed", inserted_count: 0, unchanged_count: 4 },
    ]);
  });

  it("makes event replay idempotent and persists the cursor transactionally", async () => {
    const signature = getBase58Decoder().decode(new Uint8Array(64).fill(9));
    const rental = "11111111111111111111111111111111";
    const batch = {
      cluster: "localnet",
      programId: PROGRAM_ADDRESS_V2,
      expectedPreviousSignature: null,
      signature,
      slot: "321",
      blockTime: "1789000200",
      events: [
        {
          cluster: "localnet",
          programId: PROGRAM_ADDRESS_V2,
          signature,
          logIndex: 3,
          action: 11,
          actionName: "DisputeOpened",
          subject: rental,
          owner: wallet.wallet,
          actor: wallet.wallet,
          amount: "10000000",
          digest: "ab".repeat(32),
          timestamp: "1789000200",
          slot: "321",
          blockTime: "1789000200",
        },
      ],
    };

    await expect(store.applyEventBatch(batch)).resolves.toEqual({
      inserted: 1,
    });
    await expect(store.applyEventBatch(batch)).resolves.toEqual({
      inserted: 0,
    });
    const eventCount = await pool.query(
      `SELECT COUNT(*)::INTEGER AS count
       FROM chain_events
       WHERE signature = $1`,
      [signature],
    );
    expect(eventCount.rows[0].count).toBe(1);
    await expect(
      store.indexerState("localnet", PROGRAM_ADDRESS_V2),
    ).resolves.toMatchObject({
      lastEventSignature: signature,
      lastEventSlot: "321",
    });
  });
});

function authService(store: PostgresStore): AuthService {
  const config = testConfig();
  return new AuthService(
    {
      domain: config.SIWS_DOMAIN,
      uri: config.SIWS_URI,
      jwtSecret: config.JWT_SECRET,
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
      accessTokenTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTtlSeconds: config.REFRESH_TOKEN_TTL_SECONDS,
      challengeTtlSeconds: config.CHALLENGE_TTL_SECONDS,
    },
    Date.now,
    store,
  );
}
