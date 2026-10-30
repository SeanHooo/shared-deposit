import {
  address,
  getAddressEncoder,
  getBase58Decoder,
  getProgramDerivedAddress,
  getU64Encoder,
} from "@solana/kit";
import type { V2Snapshot } from "../../app/src/chain-v2.js";
import {
  DEPOSIT_PASSPORT_DISCRIMINATOR,
  MERCHANT_DISCRIMINATOR,
  PLATFORM_DISCRIMINATOR,
  RENTAL_LOCK_DISCRIMINATOR,
  findMerchantPda,
  findPassportPda,
} from "../../app/src/generated-v2/index.js";
import type { AppConfig } from "../src/config.js";

const ZERO = address("11111111111111111111111111111111");
const USDC_MINT = address("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const PROGRAM = address("BZnWbeR8y5C7WWWLatmmEmcbL2rXqMka5jTV2XsikdCM");

export type SyntheticWallet = {
  wallet: string;
  sign: (message: string) => Promise<string>;
};

export async function syntheticWallet(): Promise<SyntheticWallet> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  );
  const publicKey = new Uint8Array(
    await crypto.subtle.exportKey("raw", keyPair.publicKey),
  );
  const wallet = getBase58Decoder().decode(publicKey);
  return {
    wallet,
    sign: async (message) => {
      const signature = new Uint8Array(
        await crypto.subtle.sign(
          { name: "Ed25519" },
          keyPair.privateKey,
          new TextEncoder().encode(message),
        ),
      );
      return getBase58Decoder().decode(signature);
    },
  };
}

export async function snapshotFor(
  guest: string,
  merchant: string,
  operator: string,
): Promise<V2Snapshot> {
  const [passport, merchantAddress] = await Promise.all([
    findPassportPda({
      owner: address(guest),
    }),
    findMerchantPda({
      merchantSigner: address(merchant),
    }),
  ]);
  const [platform] = await getProgramDerivedAddress({
    programAddress: PROGRAM,
    seeds: [new TextEncoder().encode("v2-platform")],
  });
  const [rental] = await getProgramDerivedAddress({
    programAddress: PROGRAM,
    seeds: [
      new TextEncoder().encode("lock-v2"),
      getAddressEncoder().encode(passport[0]),
      getU64Encoder().encode(0n),
    ],
  });
  return {
    platform: {
      address: platform,
      data: {
        discriminator: PLATFORM_DISCRIMINATOR,
        operator: address(operator),
        usdcMint: USDC_MINT,
        bump: 255,
      },
    },
    passports: [
      {
        address: passport[0],
        data: {
          discriminator: DEPOSIT_PASSPORT_DISCRIMINATOR,
          owner: address(guest),
          activeLock: ZERO,
          nextNonce: 0n,
          bump: 255,
        },
      },
    ],
    deposits: [],
    merchants: [
      {
        address: merchantAddress[0],
        data: {
          discriminator: MERCHANT_DISCRIMINATOR,
          authority: address(merchant),
          operator: address(operator),
          active: true,
          name: "Harbour Outdoor",
          bump: 255,
        },
      },
    ],
    authorizations: [],
    rentals: [
      {
        address: rental,
        data: {
          discriminator: RENTAL_LOCK_DISCRIMINATOR,
          passport: passport[0],
          owner: address(guest),
          merchant: merchantAddress[0],
          depositAccount: ZERO,
          amount: 10_000_000n,
          startedAt: 1_789_000_000n,
          dueAt: 1_790_000_000n,
          itemId: "kayak-17",
          status: 2,
          nonce: 0n,
          returnedAt: 0n,
          disputedAt: 1_789_100_000n,
          resolvedAt: 0n,
          evidenceDigest: new Uint8Array(32).fill(1),
          resolutionDigest: new Uint8Array(32),
          rulesVersion: 2,
          bump: 255,
        },
      },
    ],
    timestamp: 1_790_000_000n,
    slot: 123n,
    deployed: true,
  };
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: 8787,
    SOLANA_CLUSTER: "localnet",
    SOLANA_RPC_URLS: ["http://127.0.0.1:8899"],
    USDC_MINT: USDC_MINT,
    SIWS_DOMAIN: "test.shared-deposit.local",
    SIWS_URI: "https://test.shared-deposit.local",
    JWT_SECRET: "test-secret-that-is-at-least-thirty-two-characters",
    JWT_ISSUER: "shared-deposit-test",
    JWT_AUDIENCE: "shared-deposit-test",
    ACCESS_TOKEN_TTL_SECONDS: 900,
    REFRESH_TOKEN_TTL_SECONDS: 86_400,
    CHALLENGE_TTL_SECONDS: 300,
    KEEPER_ALLOWLIST: [],
    EVIDENCE_BUCKET: "evidence",
    ...overrides,
  };
}
