import {
  createSolanaRpc,
  getBase64Encoder,
  type Address,
  type Decoder,
  type ReadonlyUint8Array,
} from "@solana/kit";
import { getMintDecoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import * as sdk from "./program-v2";
import { PROGRAM_ADDRESS_V2, USDC_DECIMALS_V2 } from "./program-v2";

export type V2Row<T> = { address: Address; data: T };

export type V2Snapshot = {
  platform: V2Row<sdk.Platform> | null;
  passports: V2Row<sdk.DepositPassport>[];
  deposits: V2Row<sdk.DepositAccount>[];
  merchants: V2Row<sdk.Merchant>[];
  authorizations: V2Row<sdk.MerchantAuthorization>[];
  rentals: V2Row<sdk.RentalLock>[];
  timestamp: bigint;
  slot: bigint;
  deployed: boolean;
};

export const emptyV2Snapshot = (): V2Snapshot => ({
  platform: null,
  passports: [],
  deposits: [],
  merchants: [],
  authorizations: [],
  rentals: [],
  timestamp: 0n,
  slot: 0n,
  deployed: false,
});

export const makeV2Rpc = (url: string) => createSolanaRpc(url);
export type V2Rpc = ReturnType<typeof makeV2Rpc>;

const matches = (bytes: Uint8Array, discriminator: ReadonlyUint8Array) =>
  discriminator.every((value, index) => bytes[index] === value);

export function decodeCheckedV2<T>(
  bytes: Uint8Array,
  owner: Address,
  discriminator: ReadonlyUint8Array,
  decoder: Decoder<T>,
): T {
  if (
    owner !== PROGRAM_ADDRESS_V2 ||
    bytes.length < 8 ||
    !matches(bytes, discriminator)
  ) {
    throw new Error("On-chain account owner or v2 discriminator mismatch.");
  }
  return decoder.decode(bytes);
}

async function assertUsdcMint(
  rpc: V2Rpc,
  mintAddress: Address,
  expectedUsdcMint?: Address,
) {
  if (expectedUsdcMint && mintAddress !== expectedUsdcMint) {
    throw new Error("The v2 platform is not configured for the expected USDC mint.");
  }
  const account = await rpc
    .getAccountInfo(mintAddress, {
      encoding: "base64",
      commitment: "confirmed",
    })
    .send();
  if (!account.value || account.value.owner !== TOKEN_PROGRAM_ADDRESS) {
    throw new Error("The v2 platform mint is not an SPL Token mint.");
  }
  const mint = getMintDecoder().decode(
    new Uint8Array(getBase64Encoder().encode(account.value.data[0])),
  );
  if (!mint.isInitialized || mint.decimals !== USDC_DECIMALS_V2) {
    throw new Error("The v2 platform mint is not initialized six-decimal USDC.");
  }
}

export async function loadV2Snapshot(
  rpc: V2Rpc,
  expectedUsdcMint?: Address,
): Promise<V2Snapshot> {
  const snapshot = emptyV2Snapshot();
  const [program, accounts, slot] = await Promise.all([
    rpc
      .getAccountInfo(PROGRAM_ADDRESS_V2, {
        encoding: "base64",
        commitment: "confirmed",
      })
      .send(),
    rpc
      .getProgramAccounts(PROGRAM_ADDRESS_V2, {
        encoding: "base64",
        commitment: "confirmed",
      })
      .send(),
    rpc.getSlot({ commitment: "confirmed" }).send(),
  ]);

  snapshot.deployed = !!program.value?.executable;
  snapshot.slot = slot;
  const timestamp = await rpc.getBlockTime(slot).send();
  if (timestamp === null) {
    throw new Error("The current on-chain block time is not readable yet.");
  }
  snapshot.timestamp = timestamp;

  for (const row of accounts) {
    const bytes = new Uint8Array(
      getBase64Encoder().encode(row.account.data[0]),
    );
    const decode = <T>(
      discriminator: ReadonlyUint8Array,
      decoder: Decoder<T>,
    ): V2Row<T> => ({
      address: row.pubkey,
      data: decodeCheckedV2(bytes, row.account.owner, discriminator, decoder),
    });

    if (matches(bytes, sdk.PLATFORM_DISCRIMINATOR)) {
      snapshot.platform = decode(
        sdk.PLATFORM_DISCRIMINATOR,
        sdk.getPlatformDecoder(),
      );
    } else if (matches(bytes, sdk.DEPOSIT_PASSPORT_DISCRIMINATOR)) {
      snapshot.passports.push(
        decode(
          sdk.DEPOSIT_PASSPORT_DISCRIMINATOR,
          sdk.getDepositPassportDecoder(),
        ),
      );
    } else if (matches(bytes, sdk.DEPOSIT_ACCOUNT_DISCRIMINATOR)) {
      snapshot.deposits.push(
        decode(
          sdk.DEPOSIT_ACCOUNT_DISCRIMINATOR,
          sdk.getDepositAccountDecoder(),
        ),
      );
    } else if (matches(bytes, sdk.MERCHANT_DISCRIMINATOR)) {
      snapshot.merchants.push(
        decode(sdk.MERCHANT_DISCRIMINATOR, sdk.getMerchantDecoder()),
      );
    } else if (matches(bytes, sdk.MERCHANT_AUTHORIZATION_DISCRIMINATOR)) {
      snapshot.authorizations.push(
        decode(
          sdk.MERCHANT_AUTHORIZATION_DISCRIMINATOR,
          sdk.getMerchantAuthorizationDecoder(),
        ),
      );
    } else if (matches(bytes, sdk.RENTAL_LOCK_DISCRIMINATOR)) {
      snapshot.rentals.push(
        decode(sdk.RENTAL_LOCK_DISCRIMINATOR, sdk.getRentalLockDecoder()),
      );
    }
  }

  if (snapshot.platform) {
    await assertUsdcMint(
      rpc,
      snapshot.platform.data.usdcMint,
      expectedUsdcMint,
    );
  }
  return snapshot;
}
