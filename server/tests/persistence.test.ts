import { readFile } from "node:fs/promises";
import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthService } from "../src/auth.js";
import { PostgresStore } from "../src/postgres.js";
import {
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
    const migration = await readFile(
      new URL("../migrations/001_runtime_persistence.sql", import.meta.url),
      "utf8",
    );
    await pool.query(migration);
    await pool.query(
      `CREATE TABLE schema_migrations (
         name TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
       )`,
    );
    await pool.query(
      "INSERT INTO schema_migrations (name) VALUES ($1)",
      ["001_runtime_persistence.sql"],
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
