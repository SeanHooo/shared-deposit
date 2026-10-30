import {
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  getU64Encoder,
  type Address,
  type Instruction,
  type ReadonlyUint8Array,
  type TransactionSigner,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import * as sdk from "./generated-v2";

export * from "./generated-v2";

export const PROGRAM_ADDRESS_V2 = sdk.SHARED_DEPOSIT_V2_PROGRAM_ADDRESS;
export const ZERO_V2 = address("11111111111111111111111111111111");
export const USDC_DECIMALS_V2 = 6;
export const USDC_UNIT_V2 = 1_000_000n;
export const MAX_PASSPORT_DEPOSIT_V2 = 100n * USDC_UNIT_V2;
export const MAX_RENTAL_DEPOSIT_V2 = 50n * USDC_UNIT_V2;
export const RULES_VERSION_V2 = 2;

export const RENTAL_STATUS_V2 = {
  ACTIVE: 0,
  RETURNED: 1,
  DISPUTED: 2,
  RELEASED_TO_GUEST: 3,
  PAID_TO_MERCHANT: 4,
  TIMED_OUT: 5,
} as const;

export type RentalStatusV2 =
  (typeof RENTAL_STATUS_V2)[keyof typeof RENTAL_STATUS_V2];

const rentalStatusLabels: Record<RentalStatusV2, string> = {
  0: "ACTIVE",
  1: "RETURNED",
  2: "DISPUTED",
  3: "RELEASED_TO_GUEST",
  4: "PAID_TO_MERCHANT",
  5: "TIMED_OUT",
};

export function rentalStatusLabel(status: number): string {
  return rentalStatusLabels[status as RentalStatusV2] ?? "UNKNOWN";
}

export function isFinalRentalStatus(status: number): boolean {
  return (
    status === RENTAL_STATUS_V2.RETURNED ||
    status === RENTAL_STATUS_V2.RELEASED_TO_GUEST ||
    status === RENTAL_STATUS_V2.PAID_TO_MERCHANT ||
    status === RENTAL_STATUS_V2.TIMED_OUT
  );
}

const text = new TextEncoder();
const addressEncoder = getAddressEncoder();
const u64Encoder = getU64Encoder();

async function pda(seed: string, ...parts: ReadonlyUint8Array[]) {
  return (
    await getProgramDerivedAddress({
      programAddress: PROGRAM_ADDRESS_V2,
      seeds: [text.encode(seed), ...parts],
    })
  )[0];
}

export const platformAddressV2 = async () =>
  (await sdk.findPlatformPda())[0];
export const passportAddressV2 = (owner: Address) =>
  pda("passport-v2", addressEncoder.encode(owner));
export const depositAddressV2 = (owner: Address, usdcMint: Address) =>
  pda("deposit-v2", addressEncoder.encode(owner), addressEncoder.encode(usdcMint));
export const merchantAddressV2 = (authority: Address) =>
  pda("merchant-v2", addressEncoder.encode(authority));
export const authorizationAddressV2 = (passport: Address, nonce: bigint) =>
  pda("auth-v2", addressEncoder.encode(passport), u64Encoder.encode(nonce));
export const rentalAddressV2 = (passport: Address, nonce: bigint) =>
  pda("lock-v2", addressEncoder.encode(passport), u64Encoder.encode(nonce));

export const tokenAddressV2 = async (owner: Address, mint: Address) =>
  (
    await findAssociatedTokenPda({
      owner,
      mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    })
  )[0];

export function parseUsdc(value: string): bigint {
  if (!/^\d+(\.\d+)?$/.test(value) || value.length > 40) {
    throw new Error("Enter a positive USDC amount.");
  }
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > USDC_DECIMALS_V2) {
    throw new Error("USDC supports at most six decimal places.");
  }
  const result =
    BigInt(whole) * USDC_UNIT_V2 +
    BigInt(fraction.padEnd(USDC_DECIMALS_V2, "0"));
  if (result <= 0n || result > 18_446_744_073_709_551_615n) {
    throw new Error("The USDC amount is outside the supported range.");
  }
  return result;
}

export function formatUsdc(value: bigint): string {
  const fraction = (value % USDC_UNIT_V2)
    .toString()
    .padStart(USDC_DECIMALS_V2, "0")
    .replace(/0+$/, "");
  return `${value / USDC_UNIT_V2}${fraction ? `.${fraction}` : ""}`;
}

export function assertRentalAmountV2(amount: bigint): void {
  if (amount <= 0n || amount > MAX_RENTAL_DEPOSIT_V2) {
    throw new Error("A rental deposit must be between 0 and 50 USDC.");
  }
}

export function assertPassportCapacityV2(
  available: bigint,
  locked: bigint,
  deposit: bigint,
): void {
  if (
    deposit <= 0n ||
    available + locked + deposit > MAX_PASSPORT_DEPOSIT_V2
  ) {
    throw new Error("A passport can hold at most 100 USDC.");
  }
}

export async function balanceInstructionsV2(
  owner: TransactionSigner,
  usdcMint: Address,
  amount: bigint,
  action: "deposit" | "withdraw",
  initializePassport: boolean,
  initializeDeposit: boolean,
): Promise<Instruction[]> {
  if (amount <= 0n) throw new Error("Amount must be positive.");

  const passport = await passportAddressV2(owner.address);
  const depositAccount = await depositAddressV2(owner.address, usdcMint);
  const ownerToken = await tokenAddressV2(owner.address, usdcMint);
  const vault = await tokenAddressV2(depositAccount, usdcMint);
  const instructions: Instruction[] = [];

  if (initializePassport) {
    instructions.push(
      await sdk.getInitializePassportInstructionAsync({ owner }),
    );
  }
  if (initializeDeposit) {
    instructions.push(
      await sdk.getInitializeDepositInstructionAsync({
        owner,
        passport,
        usdcMint,
        depositAccount,
        vault,
      }),
    );
  }

  instructions.push(
    getCreateAssociatedTokenIdempotentInstruction({
      payer: owner,
      ata: ownerToken,
      owner: owner.address,
      mint: usdcMint,
    }),
  );
  instructions.push(
    await (action === "deposit"
      ? sdk.getDepositInstructionAsync({
          owner,
          passport,
          depositAccount,
          ownerToken,
          vault,
          amount,
        })
      : sdk.getWithdrawInstructionAsync({
          owner,
          passport,
          depositAccount,
          ownerToken,
          vault,
          amount,
        })),
  );
  return instructions;
}
