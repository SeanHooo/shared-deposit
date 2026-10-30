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
  ConflictError,
  UnauthorizedError,
} from "./errors.js";

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

type Challenge = {
  id: string;
  wallet: string;
  nonce: string;
  message: string;
  expiresAt: number;
};

type RefreshRecord = {
  wallet: string;
  familyId: string;
  expiresAt: number;
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
  private readonly challenges = new Map<string, Challenge>();
  private readonly refreshTokens = new Map<string, RefreshRecord>();
  private readonly usedRefreshTokens = new Map<string, string>();
  private readonly secret: Uint8Array;

  constructor(
    private readonly config: AuthConfig,
    private readonly now: () => number = Date.now,
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
    this.challenges.set(id, {
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
    const challenge = this.challenges.get(input.challengeId);
    this.challenges.delete(input.challengeId);
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
    const tokenHash = sha256(refreshToken);
    const current = this.refreshTokens.get(tokenHash);
    if (!current) {
      const compromisedFamily = this.usedRefreshTokens.get(tokenHash);
      if (compromisedFamily) {
        this.revokeFamily(compromisedFamily);
      }
      throw new UnauthorizedError("The refresh token is invalid or already used.");
    }
    this.refreshTokens.delete(tokenHash);
    this.usedRefreshTokens.set(tokenHash, current.familyId);
    if (current.expiresAt <= this.now()) {
      throw new UnauthorizedError("The refresh token has expired.");
    }
    return this.createRefreshFamily(current.wallet, current.familyId);
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = sha256(refreshToken);
    const current = this.refreshTokens.get(tokenHash);
    if (current) {
      this.revokeFamily(current.familyId);
      return;
    }
    const usedFamily = this.usedRefreshTokens.get(tokenHash);
    if (usedFamily) this.revokeFamily(usedFamily);
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
    const issuedAt = Math.floor(this.now() / 1000);
    const accessExpiresAt =
      issuedAt + this.config.accessTokenTtlSeconds;
    const refreshToken = randomBytes(48).toString("base64url");
    const refreshExpiresAt =
      this.now() + this.config.refreshTokenTtlSeconds * 1000;
    this.refreshTokens.set(sha256(refreshToken), {
      wallet,
      familyId,
      expiresAt: refreshExpiresAt,
    });
    const accessToken = await new SignJWT({
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
    return {
      accessToken,
      refreshToken,
      expiresIn: this.config.accessTokenTtlSeconds,
    };
  }

  private revokeFamily(familyId: string): void {
    for (const [hash, record] of this.refreshTokens) {
      if (record.familyId === familyId) this.refreshTokens.delete(hash);
    }
    for (const [hash, recordedFamily] of this.usedRefreshTokens) {
      if (recordedFamily === familyId) this.usedRefreshTokens.delete(hash);
    }
  }
}

export const authTestHelpers = {
  buildChallengeMessage,
  isWallet,
  sha256,
};
