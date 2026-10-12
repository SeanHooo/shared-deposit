import {
  createSolanaRpc,
  getBase64Encoder,
  type Address,
  type Decoder,
  type ReadonlyUint8Array,
} from "@solana/kit";
import * as sdk from "./program";
import { PROGRAM_ADDRESS, ZERO } from "./program";
export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const LOCAL_GENESIS = "localnet";
export type Row<T> = { address: Address; data: T };
export type Snapshot = {
  platform: Row<sdk.Platform> | null;
  passports: Row<sdk.DepositPassport>[];
  deposits: Row<sdk.DepositAccount>[];
  merchants: Row<sdk.Merchant>[];
  authorizations: Row<sdk.MerchantAuthorization>[];
  rentals: Row<sdk.RentalLock>[];
  timestamp: bigint;
  slot: bigint;
  deployed: boolean;
};
export const emptySnapshot = (): Snapshot => ({
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
export const makeRpc = (url: string) => createSolanaRpc(url);
export type PassportRpc = ReturnType<typeof makeRpc>;
const accountSizes = new Map([
  [sdk.PLATFORM_DISCRIMINATOR.join(","), 105],
  [sdk.DEPOSIT_PASSPORT_DISCRIMINATOR.join(","), 81],
  [sdk.DEPOSIT_ACCOUNT_DISCRIMINATOR.join(","), 131],
  [sdk.MERCHANT_DISCRIMINATOR.join(","), 142],
  [sdk.MERCHANT_AUTHORIZATION_DISCRIMINATOR.join(","), 240],
  [sdk.RENTAL_LOCK_DISCRIMINATOR.join(","), 548],
]);
export async function assertNetwork(rpc: PassportRpc, local: boolean) {
  const genesis = await rpc.getGenesisHash().send();
  if (!local && genesis !== DEVNET_GENESIS)
    throw new Error("RPC 不是 Solana devnet，已阻止资金操作。");
}
function matches(bytes: Uint8Array, discriminator: ReadonlyUint8Array) {
  return discriminator.every((value, i) => bytes[i] === value);
}
export function decodeChecked<T>(
  bytes: Uint8Array,
  owner: Address,
  discriminator: ReadonlyUint8Array,
  decoder: Decoder<T>,
): T {
  if (
    owner !== PROGRAM_ADDRESS ||
    bytes.length < 8 ||
    (accountSizes.has(discriminator.join(",")) &&
      bytes.length !== accountSizes.get(discriminator.join(","))) ||
    !matches(bytes, discriminator)
  )
    throw new Error("链上账户的 owner 或 discriminator 不匹配。");
  return decoder.decode(bytes);
}
export async function loadSnapshot(rpc: PassportRpc): Promise<Snapshot> {
  const snapshot = emptySnapshot();
  const [program, accounts, slot] = await Promise.all([
    rpc
      .getAccountInfo(PROGRAM_ADDRESS, {
        encoding: "base64",
        commitment: "confirmed",
      })
      .send(),
    rpc
      .getProgramAccounts(PROGRAM_ADDRESS, {
        encoding: "base64",
        commitment: "confirmed",
      })
      .send(),
    rpc.getSlot({ commitment: "confirmed" }).send(),
  ]);
  snapshot.deployed = !!program.value?.executable;
  snapshot.slot = slot;
  const timestamp = await rpc.getBlockTime(slot).send();
  if (timestamp === null) throw new Error('当前链上区块时间暂不可读取，请刷新。');
  snapshot.timestamp = timestamp;
  for (const row of accounts) {
    const bytes = new Uint8Array(
      getBase64Encoder().encode(row.account.data[0]),
    );
    const owner = row.account.owner;
    if (owner !== PROGRAM_ADDRESS)
      throw new Error("RPC 返回了不属于本程序的账户。");
    const decode = <T>(
      discriminator: ReadonlyUint8Array,
      decoder: Decoder<T>,
    ) => ({
      address: row.pubkey,
      data: decodeChecked(bytes, owner, discriminator, decoder),
    });
    if (matches(bytes, sdk.PLATFORM_DISCRIMINATOR))
      snapshot.platform = decode(
        sdk.PLATFORM_DISCRIMINATOR,
        sdk.getPlatformDecoder(),
      );
    else if (matches(bytes, sdk.DEPOSIT_PASSPORT_DISCRIMINATOR))
      snapshot.passports.push(
        decode(
          sdk.DEPOSIT_PASSPORT_DISCRIMINATOR,
          sdk.getDepositPassportDecoder(),
        ),
      );
    else if (matches(bytes, sdk.DEPOSIT_ACCOUNT_DISCRIMINATOR))
      snapshot.deposits.push(
        decode(
          sdk.DEPOSIT_ACCOUNT_DISCRIMINATOR,
          sdk.getDepositAccountDecoder(),
        ),
      );
    else if (matches(bytes, sdk.MERCHANT_DISCRIMINATOR))
      snapshot.merchants.push(
        decode(sdk.MERCHANT_DISCRIMINATOR, sdk.getMerchantDecoder()),
      );
    else if (matches(bytes, sdk.MERCHANT_AUTHORIZATION_DISCRIMINATOR))
      snapshot.authorizations.push(
        decode(
          sdk.MERCHANT_AUTHORIZATION_DISCRIMINATOR,
          sdk.getMerchantAuthorizationDecoder(),
        ),
      );
    else if (matches(bytes, sdk.RENTAL_LOCK_DISCRIMINATOR))
      snapshot.rentals.push(
        decode(sdk.RENTAL_LOCK_DISCRIMINATOR, sdk.getRentalLockDecoder()),
      );
  }
  return snapshot;
}
export type HistoryRow = sdk.PassportEventEvent & { signature: string };
export async function loadHistory(
  rpc: PassportRpc,
  account: Address,
  before?: string,
) {
  const signatures = await rpc
    .getSignaturesForAddress(account, {
      limit: 20,
      commitment: "confirmed",
      ...(before
        ? {
            before: before as Parameters<
              PassportRpc["getSignatureStatuses"]
            >[0][number],
          }
        : {}),
    })
    .send();
  const rows: HistoryRow[] = [];
  // Sequential reads limit devnet RPC throttling. Only trust data emitted in our invocation.
  for (const entry of signatures) {
    if (entry.err) continue;
    const tx = await rpc
      .getTransaction(entry.signature, {
        encoding: "json",
        maxSupportedTransactionVersion: 1,
        commitment: "confirmed",
      })
      .send();
    const stack: string[] = [];
    for (const line of tx?.meta?.logMessages ?? []) {
      const invoke = /^Program (\S+) invoke/.exec(line);
      if (invoke) {
        stack.push(invoke[1]);
        continue;
      }
      if (/^Program \S+ (success|failed)/.test(line)) {
        stack.pop();
        continue;
      }
      if (
        stack.at(-1) !== PROGRAM_ADDRESS ||
        !line.startsWith("Program data: ")
      )
        continue;
      const bytes = new Uint8Array(getBase64Encoder().encode(line.slice(14)));
      if (!matches(bytes, sdk.PASSPORT_EVENT_EVENT_DISCRIMINATOR)) continue;
      rows.push({
        ...sdk.getPassportEventEventDecoder().decode(bytes),
        signature: entry.signature,
      });
    }
  }
  return {
    rows,
    cursor: signatures.length === 20 ? signatures.at(-1)!.signature : null,
  };
}
export const assetMint = (asset: sdk.Asset, platform: sdk.Platform): Address =>
  asset === "SOL"
    ? ZERO
    : asset === "USDC"
      ? platform.usdcMint
      : platform.usdtMint;
export const assetFor = (mint: Address, platform: sdk.Platform): sdk.Asset =>
  mint === ZERO ? "SOL" : mint === platform.usdcMint ? "USDC" : "USDT";
