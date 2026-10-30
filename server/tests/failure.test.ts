import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { AuthService } from "../src/auth.js";
import { buildApp } from "../src/app.js";
import type { ChainGateway } from "../src/chain.js";
import { ChainUnavailableError } from "../src/errors.js";
import { InMemoryMetadataStore } from "../src/store.js";
import {
  syntheticWallet,
  testConfig,
  type SyntheticWallet,
} from "./fixtures.js";

describe("API dependency failures", () => {
  let app: FastifyInstance;
  let wallet: SyntheticWallet;
  let accessToken: string;

  beforeAll(async () => {
    wallet = await syntheticWallet();
    const config = testConfig();
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
    accessToken = (await auth.issueTokens(wallet.wallet)).accessToken;
    const chain: ChainGateway = {
      load: async () => {
        throw new ChainUnavailableError("All Solana RPCs failed.");
      },
      lastSource: () => null,
    };
    app = await buildApp({
      config,
      chain,
      auth,
      store: new InMemoryMetadataStore(),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 503 without exposing a partial chain snapshot", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      code: "CHAIN_UNAVAILABLE",
      message: "All Solana RPCs failed.",
    });
    expect(response.json().wallet).toBeUndefined();
    expect(response.body).not.toContain(wallet.wallet);
  });
});
