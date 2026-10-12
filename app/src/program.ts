import {
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  getU64Encoder,
  type Address,
  type Instruction,
  type TransactionSigner,
  type ReadonlyUint8Array,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import * as sdk from "./generated/index";
export * from "./generated/index";

export const PROGRAM_ADDRESS = sdk.SHARED_DEPOSIT_PASSPORT_PROGRAM_ADDRESS;
export const ZERO = address("11111111111111111111111111111111");
export const LOADER = address("BPFLoaderUpgradeab1e11111111111111111111111");
const text = new TextEncoder();
const addr = getAddressEncoder();
export async function pda(seed: string, ...parts: ReadonlyUint8Array[]) {
  return (
    await getProgramDerivedAddress({
      programAddress: PROGRAM_ADDRESS,
      seeds: [text.encode(seed), ...parts],
    })
  )[0];
}
export const platformAddress = () => pda("platform");
export const passportAddress = (owner: Address) =>
  pda("passport", addr.encode(owner));
export const depositAddress = (owner: Address, mint: Address = ZERO) =>
  pda("deposit", addr.encode(owner), addr.encode(mint));
export const merchantAddress = (authority: Address) =>
  pda("merchant", addr.encode(authority));
export const authorizationAddress = (passport: Address, nonce: bigint) =>
  pda("auth", addr.encode(passport), getU64Encoder().encode(nonce));
export const rentalAddress = (passport: Address, nonce: bigint) =>
  pda("lock", addr.encode(passport), getU64Encoder().encode(nonce));
export const programDataAddress = async () =>
  (
    await getProgramDerivedAddress({
      programAddress: LOADER,
      seeds: [addr.encode(PROGRAM_ADDRESS)],
    })
  )[0];
export const tokenAddress = async (owner: Address, mint: Address) =>
  (
    await findAssociatedTokenPda({
      owner,
      mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    })
  )[0];

export async function balanceInstructions(
  owner: TransactionSigner,
  mint: Address,
  amount: bigint,
  action: "deposit" | "withdraw",
  initializePassport: boolean,
  initializeAsset: boolean,
): Promise<Instruction[]> {
  const passport = await passportAddress(owner.address);
  const depositAccount = await depositAddress(owner.address, mint);
  const platform = await platformAddress();
  const instructions: Instruction[] = [];
  if (initializePassport)
    instructions.push(
      sdk.getInitializePassportInstruction({ owner, passport }),
    );
  if (mint === ZERO) {
    if (initializeAsset)
      instructions.push(
        sdk.getInitializeSolAccountInstruction({
          owner,
          passport,
          platform,
          depositAccount,
        }),
      );
    instructions.push(
      (action === "deposit"
        ? sdk.getDepositSolInstruction
        : sdk.getWithdrawSolInstruction)({
        owner,
        passport,
        depositAccount,
        amount,
      }),
    );
  } else {
    const ownerToken = await tokenAddress(owner.address, mint);
    const vault = await tokenAddress(depositAccount, mint);
    if (initializeAsset)
      instructions.push(
        sdk.getInitializeSplAccountInstruction({
          owner,
          passport,
          platform,
          mint,
          depositAccount,
          vault,
        }),
      );
    instructions.push(
      getCreateAssociatedTokenIdempotentInstruction({
        payer: owner,
        ata: ownerToken,
        owner: owner.address,
        mint,
      }),
    );
    instructions.push(
      (action === "deposit"
        ? sdk.getDepositSplInstruction
        : sdk.getWithdrawSplInstruction)({
        owner,
        passport,
        depositAccount,
        ownerToken,
        vault,
        amount,
      }),
    );
  }
  return instructions;
}

export type Asset = "USDC" | "USDT" | "SOL";
export const decimals = (asset: Asset) => (asset === "SOL" ? 9 : 6);
export function parseAmount(value: string, asset: Asset): bigint {
  const precision = decimals(asset);
  if (!/^\d+(\.\d+)?$/.test(value) || value.length > 40)
    throw new Error(
      "Enter a positive amount; negatives, exponents and special characters are not supported.",
    );
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > precision)
    throw new Error(
      `${asset} supports at most ${precision} decimal places.`,
    );
  const result =
    BigInt(whole) * 10n ** BigInt(precision) +
    BigInt(fraction.padEnd(precision, "0"));
  if (result <= 0n || result > 18446744073709551615n)
    throw new Error(
      "The amount is outside the valid range for this asset's native precision.",
    );
  return result;
}
export function formatAmount(value: bigint, asset: Asset) {
  const scale = 10n ** BigInt(decimals(asset));
  const fraction = (value % scale)
    .toString()
    .padStart(decimals(asset), "0")
    .replace(/0+$/, "");
  return `${value / scale}${fraction ? `.${fraction}` : ""}`;
}
