import { describe, expect, it } from "vitest";
import { AuthService } from "../src/auth.js";
import { testConfig } from "./fixtures.js";
import { syntheticWallet } from "./fixtures.js";

function authService(now: () => number): AuthService {
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
    now,
  );
}

describe("SIWS challenge validation", () => {
  it("rejects an expired one-time challenge", async () => {
    let now = 1_790_000_000_000;
    const auth = authService(() => now);
    const wallet = await syntheticWallet();
    const challenge = await auth.challenge(wallet.wallet);
    now += (300 + 1) * 1000;

    await expect(
      auth.consumeChallenge({
        challengeId: challenge.challengeId,
        wallet: wallet.wallet,
        signature: await wallet.sign(challenge.message),
      }),
    ).rejects.toThrow("invalid or expired");
  });

  it("rejects a signature produced for a different message", async () => {
    const auth = authService(() => 1_790_000_000_000);
    const wallet = await syntheticWallet();
    const challenge = await auth.challenge(wallet.wallet);

    await expect(
      auth.consumeChallenge({
        challengeId: challenge.challengeId,
        wallet: wallet.wallet,
        signature: await wallet.sign(`${challenge.message}\ntampered`),
      }),
    ).rejects.toThrow("signature is invalid");
  });
});
