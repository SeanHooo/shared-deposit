import { randomBytes, randomUUID, createHash } from "node:crypto";
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getBase58Encoder,
  getBase64Encoder,
  type Address,
} from "@solana/kit";
import { jwtVerify, SignJWT } from "jose";
import {
  UnauthorizedError,
} from "./errors.js";
import {
  InMemoryAuthStore,
  type AuthStore,
} from "./store.js";

export type AuthConfig = {
  domain: string;
  uri: string;
  jwtSecret: string;
  issuer: string;
  audience: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  challengeTtlSeconds: number;
};

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

const SIGNATURE_BYTES = 64;
const encoder = new TextEncoder();
const addressEncoder = getAddressEncoder();

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isWallet(value: string): boolean {
  try {
    return addressEncoder.encode(address(value)).length === 32;
  } catch {
    return false;
  }
}

function decodeSignature(value: string): Uint8Array | null {
  const encoders = [getBase58Encoder(), getBase64Encoder()];
  for (const encoder of encoders) {
    try {
      const decoded = new Uint8Array(encoder.encode(value));
      if (decoded.byteLength === SIGNATURE_BYTES) return decoded;
    } catch {
      // Try the next wallet signature encoding.
    }
  }
  return null;
}

async function verifyEd25519(
  wallet: string,
  signature: string,
  message: string,
): Promise<boolean> {
  if (!isWallet(wallet)) return false;
  const signatureBytes = decodeSignature(signature);
  if (!signatureBytes) return false;
  try {
    const publicKey = addressEncoder.encode(address(wallet) as Address);
    const key = await crypto.subtle.importKey(
      "raw",
      publicKey,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      signatureBytes,
      encoder.encode(message),
    );
  } catch {
    return false;
  }
}

function buildChallengeMessage(input: {
  domain: string;
  wallet: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  uri: string;
}): string {
  return [
    `${input.domain} wants you to sign in with your Solana account:`,
    input.wallet,
    "",
    "Sign in to Shared Deposit.",
    "",
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration Time: ${input.expiresAt}`,
    `URI: ${input.uri}`,
  ].join("\n");
}

export class AuthService {
  private readonly secret: Uint8Array;

  constructor(
    private readonly config: AuthConfig,
    private readonly now: () => number = Date.now,
    private readonly store: AuthStore = new InMemoryAuthStore(),
  ) {
    this.secret = encoder.encode(config.jwtSecret);
  }

  async challenge(wallet: string) {
    if (!isWallet(wallet)) {
      throw new UnauthorizedError("The wallet address is invalid.");
    }
    const issuedAtMs = this.now();
    const expiresAtMs = issuedAtMs + this.config.challengeTtlSeconds * 1000;
    const id = randomUUID();
    const nonce = randomBytes(24).toString("base64url");
    const message = buildChallengeMessage({
      domain: this.config.domain,
      wallet,
      nonce,
      issuedAt: new Date(issuedAtMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      uri: this.config.uri,
    });
    await this.store.saveChallenge({
      id,
      wallet,
      nonce,
      message,
      expiresAt: expiresAtMs,
    });
    return {
      challengeId: id,
      wallet,
      message,
      nonce,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  async consumeChallenge(input: {
    challengeId: string;
    wallet: string;
    signature: string;
  }): Promise<void> {
    const challenge = await this.store.takeChallenge(input.challengeId);
    if (!challenge) {
      throw new UnauthorizedError("The sign-in challenge is unknown or used.");
    }
    if (
      challenge.wallet !== input.wallet ||
      challenge.expiresAt <= this.now()
    ) {
      throw new UnauthorizedError("The sign-in challenge is invalid or expired.");
    }
    if (
      !(await verifyEd25519(
        input.wallet,
        input.signature,
        challenge.message,
      ))
    ) {
      throw new UnauthorizedError("The wallet signature is invalid.");
    }
  }

  async issueTokens(wallet: string): Promise<TokenPair> {
    return this.createRefreshFamily(wallet, randomUUID());
  }

  async rotateRefresh(refreshToken: string): Promise<TokenPair> {
    const now = this.now();
    const nextRefreshToken = randomBytes(48).toString("base64url");
    const rotation = await this.store.rotateRefresh({
      currentTokenHash: sha256(refreshToken),
      nextTokenHash: sha256(nextRefreshToken),
      nextExpiresAt: now + this.config.refreshTokenTtlSeconds * 1000,
      now,
    });
    if (rotation.status !== "ok") {
      throw new UnauthorizedError(
        "The refresh token is invalid, expired, or already used.",
      );
    }
    return {
      accessToken: await this.createAccessToken(rotation.wallet),
      refreshToken: nextRefreshToken,
      expiresIn: this.config.accessTokenTtlSeconds,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.store.revokeRefreshToken(sha256(refreshToken));
  }

  async verifyAccessToken(token: string): Promise<string> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        algorithms: ["HS256"],
        issuer: this.config.issuer,
        audience: this.config.audience,
      });
      if (
        payload.token_use !== "access" ||
        typeof payload.sub !== "string" ||
        !isWallet(payload.sub)
      ) {
        throw new Error("Invalid access-token claims.");
      }
      return payload.sub;
    } catch {
      throw new UnauthorizedError("The access token is invalid or expired.");
    }
  }

  private async createRefreshFamily(
    wallet: string,
    familyId: string,
  ): Promise<TokenPair> {
    const refreshToken = randomBytes(48).toString("base64url");
    const refreshExpiresAt =
      this.now() + this.config.refreshTokenTtlSeconds * 1000;
    const accessToken = await this.createAccessToken(wallet);
    await this.store.addRefreshToken({
      tokenHash: sha256(refreshToken),
      wallet,
      familyId,
      expiresAt: refreshExpiresAt,
      usedAt: null,
    });
    return {
      accessToken,
      refreshToken,
      expiresIn: this.config.accessTokenTtlSeconds,
    };
  }

  private async createAccessToken(wallet: string): Promise<string> {
    const issuedAt = Math.floor(this.now() / 1000);
    const accessExpiresAt =
      issuedAt + this.config.accessTokenTtlSeconds;
    return new SignJWT({
      token_use: "access",
      wallet,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(wallet)
      .setIssuer(this.config.issuer)
      .setAudience(this.config.audience)
      .setIssuedAt(issuedAt)
      .setExpirationTime(accessExpiresAt)
      .setJti(randomUUID())
      .sign(this.secret);
  }
}

export const authTestHelpers = {
  buildChallengeMessage,
  isWallet,
  sha256,
};
