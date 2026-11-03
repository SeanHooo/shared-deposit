import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { address } from "@solana/kit";
import { buildApp } from "../src/app.js";
import { AuthService } from "../src/auth.js";
import { FixedChainGateway } from "../src/chain.js";
import type { IndexerRuntimeState } from "../src/indexer-types.js";
import { InMemoryMetadataStore } from "../src/store.js";
import type { SyntheticWallet } from "./fixtures.js";
import {
  snapshotFor,
  syntheticWallet,
  testConfig,
} from "./fixtures.js";

describe.sequential("Shared Deposit API", () => {
  let app: FastifyInstance;
  let guest: SyntheticWallet;
  let merchant: SyntheticWallet;
  let operator: SyntheticWallet;
  let outsider: SyntheticWallet;
  let rental: string;
  let store: InMemoryMetadataStore;
  let indexerState: IndexerRuntimeState;
  const guestNotification = "0e4ac83b-b35c-4fc4-8cf8-7a8e73208f2d";
  const merchantNotification = "d97cb9ca-f04b-42a2-a7c5-51340b832e56";

  async function login(wallet: SyntheticWallet) {
    const challengeResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/challenge",
      payload: { wallet: wallet.wallet },
    });
    expect(challengeResponse.statusCode).toBe(201);
    const challenge = challengeResponse.json<{
      challengeId: string;
      message: string;
      nonce: string;
    }>();
    const verifyResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/verify",
      payload: {
        challengeId: challenge.challengeId,
        wallet: wallet.wallet,
        signature: await wallet.sign(challenge.message),
      },
    });
    expect(verifyResponse.statusCode).toBe(200);
    return verifyResponse.json<{
      accessToken: string;
      refreshToken: string;
      wallet: string;
      roles: Record<string, boolean>;
    }>();
  }

  beforeAll(async () => {
    [guest, merchant, operator, outsider] = await Promise.all(
      Array.from({ length: 4 }, syntheticWallet),
    );
    const config = testConfig();
    const snapshot = await snapshotFor(
      guest.wallet,
      merchant.wallet,
      operator.wallet,
    );
    rental = snapshot.rentals[0].address;
    const auth = new AuthService({
      domain: config.SIWS_DOMAIN,
      uri: config.SIWS_URI,
      jwtSecret: config.JWT_SECRET,
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
      accessTokenTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTtlSeconds: config.REFRESH_TOKEN_TTL_SECONDS,
      challengeTtlSeconds: config.CHALLENGE_TTL_SECONDS,
    });
    store = new InMemoryMetadataStore();
    indexerState = {
      cluster: "localnet",
      programId: "5rnNqVQG4zy4JUYHWxCEaYsbBEpNu8fHLn9p2MsdrVfx",
      lastEventSignature: "fixture-signature",
      lastEventSlot: "100",
      lastEventScanSlot: "123",
      lastObservedSlot: "123",
      lastAttemptAt: "2026-09-21T14:13:20.000Z",
      lastSuccessAt: "2026-09-21T14:13:20.000Z",
      lastReconciliationAt: "2026-09-21T14:13:20.000Z",
      lastError: null,
      updatedAt: "2026-09-21T14:13:20.000Z",
    };
    store.seedNotification({
      id: guestNotification,
      wallet: guest.wallet,
      kind: "rental",
      title: "Rental due soon",
      body: "Return the kayak before the due time.",
      rental,
      readAt: null,
      createdAt: "2026-10-30T00:00:00.000Z",
    });
    store.seedNotification({
      id: merchantNotification,
      wallet: merchant.wallet,
      kind: "dispute",
      title: "Dispute evidence requested",
      body: "Add evidence for the open dispute.",
      rental,
      readAt: null,
      createdAt: "2026-10-30T00:01:00.000Z",
    });
    app = await buildApp({
      config,
      chain: new FixedChainGateway(snapshot),
      auth,
      store,
      indexerHealth: async () => indexerState,
      now: () => 1_790_000_000_000,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves health and a complete OpenAPI contract", async () => {
    const health = await app.inject({ method: "GET", url: "/v1/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({
      status: "ok",
      cluster: "localnet",
      evidenceStorage: "metadata-only",
      indexer: {
        status: "healthy",
        eventLagSlots: "0",
      },
    });

    const openapi = await app.inject({
      method: "GET",
      url: "/documentation/json",
    });
    expect(openapi.statusCode).toBe(200);
    const paths = openapi.json<{ paths: Record<string, unknown> }>().paths;
    expect(paths).toHaveProperty("/v1/auth/challenge");
    expect(paths).toHaveProperty("/v1/auth/verify");
    expect(paths).toHaveProperty("/v1/auth/refresh");
    expect(paths).toHaveProperty("/v1/rentals");
    expect(paths).toHaveProperty("/v1/disputes");
    expect(paths).toHaveProperty("/v1/evidence");
    expect(paths).toHaveProperty("/v1/notifications");
  });

  it("marks stale or lagging indexers as degraded", async () => {
    const originalState = { ...indexerState };
    try {
      indexerState.lastSuccessAt = "2026-09-21T14:10:00.000Z";
      const stale = await app.inject({ method: "GET", url: "/v1/health" });
      expect(stale.json()).toMatchObject({
        status: "degraded",
        indexer: { status: "degraded" },
      });

      indexerState.lastSuccessAt = "2026-09-21T14:13:20.000Z";
      indexerState.lastEventScanSlot = "0";
      indexerState.lastObservedSlot = "1000";
      const lagging = await app.inject({ method: "GET", url: "/v1/health" });
      expect(lagging.json()).toMatchObject({
        status: "degraded",
        indexer: {
          status: "degraded",
          eventLagSlots: "1000",
        },
      });

      indexerState.lastObservedSlot = "0";
      indexerState.lastEventScanSlot = null;
      indexerState.lastSuccessAt = null;
      indexerState.lastAttemptAt = "2026-09-21T14:13:20.000Z";
      const starting = await app.inject({ method: "GET", url: "/v1/health" });
      expect(starting.json()).toMatchObject({
        status: "ok",
        indexer: {
          status: "starting",
          eventLagSlots: null,
        },
      });
    } finally {
      Object.assign(indexerState, originalState);
    }
  });

  it("omits indexer health when no indexer state source is configured", async () => {
    const appWithoutIndexer = await buildApp({
      config: testConfig(),
      chain: new FixedChainGateway(
        await snapshotFor(guest.wallet, merchant.wallet, operator.wallet),
      ),
      auth: new AuthService({
        domain: testConfig().SIWS_DOMAIN,
        uri: testConfig().SIWS_URI,
        jwtSecret: testConfig().JWT_SECRET,
        issuer: testConfig().JWT_ISSUER,
        audience: testConfig().JWT_AUDIENCE,
        accessTokenTtlSeconds: testConfig().ACCESS_TOKEN_TTL_SECONDS,
        refreshTokenTtlSeconds: testConfig().REFRESH_TOKEN_TTL_SECONDS,
        challengeTtlSeconds: testConfig().CHALLENGE_TTL_SECONDS,
      }),
      store,
    });
    try {
      const health = await appWithoutIndexer.inject({
        method: "GET",
        url: "/v1/health",
      });
      expect(health.json()).toMatchObject({
        status: "ok",
        indexer: null,
      });
    } finally {
      await appWithoutIndexer.close();
    }
  });

  it("degrades when the indexer has never recorded an attempt", async () => {
    const appWithoutState = await buildApp({
      config: testConfig(),
      chain: new FixedChainGateway(
        await snapshotFor(guest.wallet, merchant.wallet, operator.wallet),
      ),
      auth: new AuthService({
        domain: testConfig().SIWS_DOMAIN,
        uri: testConfig().SIWS_URI,
        jwtSecret: testConfig().JWT_SECRET,
        issuer: testConfig().JWT_ISSUER,
        audience: testConfig().JWT_AUDIENCE,
        accessTokenTtlSeconds: testConfig().ACCESS_TOKEN_TTL_SECONDS,
        refreshTokenTtlSeconds: testConfig().REFRESH_TOKEN_TTL_SECONDS,
        challengeTtlSeconds: testConfig().CHALLENGE_TTL_SECONDS,
      }),
      store,
      indexerHealth: async () => null,
    });
    try {
      const health = await appWithoutState.inject({
        method: "GET",
        url: "/v1/health",
      });
      expect(health.json()).toMatchObject({
        status: "degraded",
        indexer: null,
      });
    } finally {
      await appWithoutState.close();
    }
  });

  it("accepts a real Ed25519 SIWS signature exactly once", async () => {
    const challengeResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/challenge",
      payload: { wallet: guest.wallet },
    });
    expect(challengeResponse.statusCode).toBe(201);
    const challenge = challengeResponse.json<{
      challengeId: string;
      message: string;
    }>();
    const payload = {
      challengeId: challenge.challengeId,
      wallet: guest.wallet,
      signature: await guest.sign(challenge.message),
    };

    const verified = await app.inject({
      method: "POST",
      url: "/v1/auth/verify",
      payload,
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().roles).toEqual({
      guest: true,
      merchant: false,
      operator: false,
      keeper: false,
    });

    const replay = await app.inject({
      method: "POST",
      url: "/v1/auth/verify",
      payload,
    });
    expect(replay.statusCode).toBe(401);
  });

  it("rejects a valid signature from a wallet with no active role", async () => {
    const challengeResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/challenge",
      payload: { wallet: outsider.wallet },
    });
    const challenge = challengeResponse.json<{
      challengeId: string;
      message: string;
    }>();
    const verified = await app.inject({
      method: "POST",
      url: "/v1/auth/verify",
      payload: {
        challengeId: challenge.challengeId,
        wallet: outsider.wallet,
        signature: await outsider.sign(challenge.message),
      },
    });
    expect(verified.statusCode).toBe(403);
  });

  it("rotates refresh tokens and revokes the family on token reuse", async () => {
    const tokens = await login(guest);
    const rotated = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refreshToken: tokens.refreshToken },
    });
    expect(rotated.statusCode).toBe(200);
    const replacement = rotated.json<{ refreshToken: string }>();
    expect(replacement.refreshToken).not.toBe(tokens.refreshToken);

    const reused = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refreshToken: tokens.refreshToken },
    });
    expect(reused.statusCode).toBe(401);

    const revokedDescendant = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refreshToken: replacement.refreshToken },
    });
    expect(revokedDescendant.statusCode).toBe(401);
  });

  it("recomputes roles and filters disputes from chain state", async () => {
    const guestTokens = await login(guest);
    const me = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${guestTokens.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      wallet: guest.wallet,
      roles: { guest: true, merchant: false },
      chainSlot: "123",
    });

    const disputes = await app.inject({
      method: "GET",
      url: "/v1/disputes",
      headers: { authorization: `Bearer ${guestTokens.accessToken}` },
    });
    expect(disputes.statusCode).toBe(200);
    expect(disputes.json().disputes).toHaveLength(1);
    expect(disputes.json().disputes[0]).toMatchObject({
      address: rental,
      statusLabel: "DISPUTED",
      amountUsdc: "10",
    });

    const merchantTokens = await login(merchant);
    expect(merchantTokens.roles.merchant).toBe(true);
    const evidence = await app.inject({
      method: "GET",
      url: `/v1/evidence/rentals/${rental}`,
      headers: {
        authorization: `Bearer ${merchantTokens.accessToken}`,
      },
    });
    expect(evidence.statusCode).toBe(200);
    expect(evidence.json().evidence).toEqual([]);
  });

  it("requires authentication for participant data", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/rentals",
    });
    expect(response.statusCode).toBe(401);
  });

  it("registers evidence only through a visible rental and rejects duplicate digests", async () => {
    const tokens = await login(guest);
    const evidenceDigest = "ab".repeat(32);
    const payload = {
      rental,
      evidenceDigest,
      objectKey: `rentals/${rental}/damage-photo.jpg`,
      contentType: "image/jpeg",
      sizeBytes: 64_000,
    };

    const hidden = await app.inject({
      method: "POST",
      url: "/v1/evidence",
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      payload: {
        ...payload,
        rental: address("11111111111111111111111111111111"),
      },
    });
    expect(hidden.statusCode).toBe(404);

    const created = await app.inject({
      method: "POST",
      url: "/v1/evidence",
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      payload,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      rental,
      evidenceDigest,
      uploadedBy: guest.wallet,
    });

    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/evidence",
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      payload,
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe("CONFLICT");
  });

  it("never exposes or mutates another wallet's notifications", async () => {
    const tokens = await login(guest);
    const list = await app.inject({
      method: "GET",
      url: "/v1/notifications",
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().notifications.map((item: { id: string }) => item.id)).toEqual([
      guestNotification,
    ]);

    const foreignRead = await app.inject({
      method: "POST",
      url: `/v1/notifications/${merchantNotification}/read`,
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(foreignRead.statusCode).toBe(404);

    const ownRead = await app.inject({
      method: "POST",
      url: `/v1/notifications/${guestNotification}/read`,
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(ownRead.statusCode).toBe(200);
    expect(ownRead.json().readAt).not.toBeNull();
  });
});
