import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Surfnet } from "@solana/surfpool";
import {
  address,
  createClient,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  generateKeyPairSigner,
  getAddressEncoder,
  getBase64Encoder,
  getBytesEncoder,
  getProgramDerivedAddress,
  getU64Encoder,
  none,
  some,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type ReadonlyUint8Array,
  type TransactionSigner,
} from "@solana/kit";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { signer } from "@solana/kit-plugin-signer";
import {
  findAssociatedTokenPda,
  getMintEncoder,
  fetchToken,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  fetchDepositAccount,
  fetchDepositPassport,
  fetchRentalLock,
} from "../src/generated-v2/accounts";
import { loadV2Snapshot } from "../src/chain-v2";
import {
  getAuthorizeRentalInstructionAsync,
  getConfirmReturnInstructionAsync,
  getDepositInstructionAsync,
  getInitializeDepositInstructionAsync,
  getInitializePassportInstructionAsync,
  getInitializePlatformInstructionAsync,
  getKeeperReleaseInstruction,
  getLockDepositInstructionAsync,
  getOpenDisputeInstructionAsync,
  getRegisterMerchantInstructionAsync,
  getResolveDisputeInstructionAsync,
  SHARED_DEPOSIT_V2_PROGRAM_ADDRESS,
} from "../src/generated-v2";
import { findMerchantPda, findPassportPda } from "../src/generated-v2/pdas";

const LOADER = address("BPFLoaderUpgradeab1e11111111111111111111111");
const encoder = getAddressEncoder();
const u64 = getU64Encoder();
const text = new TextEncoder();
const USDC = 1_000_000n;
const DAY = 86_400n;
const MAX_RENTAL = 50n * USDC;
const MAX_PASSPORT = 100n * USDC;

async function pda(seed: string, ...parts: ReadonlyUint8Array[]) {
  return (
    await getProgramDerivedAddress({
      programAddress: SHARED_DEPOSIT_V2_PROGRAM_ADDRESS,
      seeds: [text.encode(seed), ...parts],
    })
  )[0];
}

const depositPda = (owner: Address, mint: Address) =>
  pda("deposit-v2", encoder.encode(owner), encoder.encode(mint));
const rentalPda = (passport: Address, nonce: bigint) =>
  pda("lock-v2", encoder.encode(passport), u64.encode(nonce));
const programDataPda = async () =>
  (
    await getProgramDerivedAddress({
      programAddress: LOADER,
      seeds: [encoder.encode(SHARED_DEPOSIT_V2_PROGRAM_ADDRESS)],
    })
  )[0];
const tokenPda = async (owner: Address, mint: Address) =>
  (
    await findAssociatedTokenPda({
      owner,
      mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    })
  )[0];

const digest = (value: number) => new Uint8Array(32).fill(value);

describe.sequential(
  "Shared Deposit v2 on Surfpool (USDC caps, disputes and keeper)",
  () => {
    let net: Surfnet;
    let operator: KeyPairSigner;
    let guest: KeyPairSigner;
    let merchant: KeyPairSigner;
    let outsider: KeyPairSigner;
    let usdc: Address;
    let wrongMint: Address;
    let platform: Address;
    let passport: Address;
    let depositAccount: Address;
    let merchantAccount: Address;
    let ownerToken: Address;
    let merchantToken: Address;
    let vault: Address;

    const rpc = () => createSolanaRpc(net.rpcUrl);
    const send = async (
      who: TransactionSigner,
      instructions: Instruction[],
    ) => {
      const client = createClient()
        .use(signer(who))
        .use(
          solanaRpc({
            rpcUrl: net.rpcUrl,
            rpcSubscriptionsUrl: net.wsUrl,
            transactionConfig: { version: 0 },
          }),
        );
      return client.sendTransaction(instructions, {
        abortSignal: AbortSignal.timeout(15_000),
      });
    };

    const currentTimestamp = async () => {
      const slot = await rpc().getSlot({ commitment: "confirmed" }).send();
      return (await rpc().getBlockTime(slot).send()) ?? 0n;
    };

    const authorize = async (amount = 10n * USDC) => {
      const current = await fetchDepositPassport(rpc(), passport);
      return getAuthorizeRentalInstructionAsync({
        owner: guest,
        merchant: merchantAccount,
        depositAccount,
        amount,
        itemId: "kayak-17",
        dueAt: (await currentTimestamp()) + 7n * DAY,
        nonce: current.data.nextNonce,
        rulesVersion: 2,
      });
    };

    const lock = async (amount = 10n * USDC) => {
      const authorization = await authorize(amount);
      const nonce = BigInt(
        (await fetchDepositPassport(rpc(), passport)).data.nextNonce,
      );
      // authorize() reads this value before advancing the passport.
      const rentalLock = await rentalPda(passport, nonce);
      await send(guest, [authorization]);
      await send(merchant, [
        await getLockDepositInstructionAsync({
          merchantSigner: merchant,
          passport,
          merchant: merchantAccount,
          depositAccount,
          authorization: (
            await getProgramDerivedAddress({
              programAddress: SHARED_DEPOSIT_V2_PROGRAM_ADDRESS,
              seeds: [
                text.encode("auth-v2"),
                encoder.encode(passport),
                u64.encode(nonce),
              ],
            })
          )[0],
          rentalLock,
        }),
      ]);
      return rentalLock;
    };

    beforeAll(async () => {
      net = Surfnet.startWithConfig({
        offline: true,
        blockProductionMode: "clock",
        slotTimeMs: 100,
      });
      // Synthetic signers only; this suite never opens a wallet key file.
      operator = await createKeyPairSignerFromBytes(net.payerSecretKey);
      [guest, merchant, outsider] = await Promise.all(
        Array.from({ length: 3 }, () => generateKeyPairSigner()),
      );
      for (const who of [guest, merchant, outsider]) {
        net.fundSol(who.address, 10_000_000_000);
      }
      net.deploy({
        programId: SHARED_DEPOSIT_V2_PROGRAM_ADDRESS,
        soPath: "../programs/shared-deposit-v2/artifacts/shared_deposit_v2.so",
      });

      const programData = await programDataPda();
      const deployed = (
        await rpc()
          .getAccountInfo(programData, { encoding: "base64" })
          .send()
      ).value!;
      const bytes = new Uint8Array(
        getBase64Encoder().encode(deployed.data[0]),
      );
      bytes[12] = 1;
      bytes.set(encoder.encode(operator.address), 13);
      net.setAccount(programData, Number(deployed.lamports), bytes, deployed.owner);

      [usdc, wrongMint] = await Promise.all(
        Array.from(
          { length: 2 },
          async () => (await generateKeyPairSigner()).address,
        ),
      );
      for (const [mint, decimals] of [
        [usdc, 6],
        [wrongMint, 9],
      ] as const) {
        net.setAccount(
          mint,
          1_461_600,
          new Uint8Array(
            getMintEncoder().encode({
              decimals,
              supply: 1_000_000_000n,
              isInitialized: true,
              mintAuthority: some(operator.address),
              freezeAuthority: none(),
            }),
          ),
          TOKEN_PROGRAM_ADDRESS,
        );
      }
      net.fundToken(guest.address, usdc, 250_000_000);
      net.fundToken(merchant.address, usdc, 1);

      platform = (
        await getProgramDerivedAddress({
          programAddress: SHARED_DEPOSIT_V2_PROGRAM_ADDRESS,
          seeds: [text.encode("v2-platform")],
        })
      )[0];
      passport = (await findPassportPda({ owner: guest.address }))[0];
      merchantAccount = (await findMerchantPda({ merchantSigner: merchant.address }))[0];
      depositAccount = await depositPda(guest.address, usdc);
      vault = await tokenPda(depositAccount, usdc);
      ownerToken = await tokenPda(guest.address, usdc);
      merchantToken = await tokenPda(merchant.address, usdc);

      await expect(
        send(operator, [
          await getInitializePlatformInstructionAsync({
            operator,
            programData,
            usdcMint: wrongMint,
          }),
        ]),
      ).rejects.toThrow();
      await send(operator, [
        await getInitializePlatformInstructionAsync({
          operator,
          programData,
          usdcMint: usdc,
        }),
      ]);
      await send(operator, [
        await getRegisterMerchantInstructionAsync({
          operator,
          merchantKey: merchant.address,
          merchant: merchantAccount,
          name: "Harbour Outdoor",
        }),
      ]);
      await send(guest, [
        await getInitializePassportInstructionAsync({ owner: guest }),
        await getInitializeDepositInstructionAsync({
          owner: guest,
          usdcMint: usdc,
          depositAccount,
        }),
      ]);
    }, 60_000);

    afterAll(() => net?.stop());

    it("loads and validates the v2 snapshot from a live Surfpool RPC", async () => {
      const snapshot = await loadV2Snapshot(rpc(), usdc);
      expect(snapshot.deployed).toBe(true);
      expect(snapshot.platform?.data.operator).toBe(operator.address);
      expect(snapshot.platform?.data.usdcMint).toBe(usdc);
      expect(snapshot.passports.some((row) => row.address === passport)).toBe(
        true,
      );
      expect(
        snapshot.merchants.some((row) => row.address === merchantAccount),
      ).toBe(true);
      expect(snapshot.timestamp).toBeGreaterThan(0n);
    }, 60_000);

    it("enforces the 100 USDC passport cap in the program and accepts only USDC", async () => {
      const ownerTokenWrongMint = await tokenPda(guest.address, wrongMint);
      await expect(
        send(guest, [
          await getDepositInstructionAsync({
            owner: guest,
            depositAccount,
            ownerToken: ownerTokenWrongMint,
            vault,
            amount: 1n,
          }),
        ]),
      ).rejects.toThrow();

      await send(guest, [
        await getDepositInstructionAsync({
          owner: guest,
          depositAccount,
          ownerToken,
          vault,
          amount: 50n * USDC,
        }),
      ]);
      await send(guest, [
        await getDepositInstructionAsync({
          owner: guest,
          depositAccount,
          ownerToken,
          vault,
          amount: 50n * USDC,
        }),
      ]);
      await expect(
        send(guest, [
          await getDepositInstructionAsync({
            owner: guest,
            depositAccount,
            ownerToken,
            vault,
            amount: 1n,
          }),
        ]),
      ).rejects.toThrow();

      const account = await fetchDepositAccount(rpc(), depositAccount);
      expect(account.data.available).toBe(MAX_PASSPORT);
      expect(account.data.locked).toBe(0n);
      expect(account.data.mint).toBe(usdc);
    }, 60_000);

    it("rejects a 50+ USDC rental and normal returns restore the exact available balance", async () => {
      await expect(
        send(guest, [await authorize(MAX_RENTAL + 1n)]),
      ).rejects.toThrow();

      const before = (await fetchDepositAccount(rpc(), depositAccount)).data
        .available;
      const rentalLock = await lock(10n * USDC);
      const active = await fetchRentalLock(rpc(), rentalLock);
      expect(active.data.status).toBe(0);
      expect(active.data.amount).toBe(10n * USDC);

      await send(merchant, [
        await getConfirmReturnInstructionAsync({
          merchantSigner: merchant,
          rentalLock,
          passport,
          depositAccount,
          evidenceDigest: digest(11),
        }),
      ]);
      const returned = await fetchRentalLock(rpc(), rentalLock);
      expect(returned.data.status).toBe(1);
      expect(returned.data.returnedAt).toBeGreaterThan(0n);
      expect(returned.data.evidenceDigest).toEqual(digest(11));
      expect((await fetchDepositPassport(rpc(), passport)).data.activeLock).toBe(
        address("11111111111111111111111111111111"),
      );
      expect(
        (await fetchDepositAccount(rpc(), depositAccount)).data,
      ).toMatchObject({ available: before, locked: 0n });
    }, 60_000);

    it("releases a disputed lock to the guest without requiring a merchant token account", async () => {
      const before = (await fetchDepositAccount(rpc(), depositAccount)).data
        .available;
      const rentalLock = await lock(12n * USDC);
      await send(merchant, [
        await getOpenDisputeInstructionAsync({
          merchantSigner: merchant,
          rentalLock,
          passport,
          depositAccount,
          evidenceDigest: digest(21),
        }),
      ]);

      await expect(
        send(outsider, [
          await getResolveDisputeInstructionAsync({
            operator: outsider,
            passport,
            depositAccount,
            merchant: merchantAccount,
            rentalLock,
            vault,
            outcome: 0,
            resolutionDigest: digest(22),
          }),
        ]),
      ).rejects.toThrow();
      await send(operator, [
        await getResolveDisputeInstructionAsync({
          operator,
          passport,
          depositAccount,
          merchant: merchantAccount,
          rentalLock,
          vault,
          outcome: 0,
          resolutionDigest: digest(22),
        }),
      ]);

      const resolved = await fetchRentalLock(rpc(), rentalLock);
      expect(resolved.data.status).toBe(3);
      expect(resolved.data.evidenceDigest).toEqual(digest(21));
      expect(resolved.data.resolutionDigest).toEqual(digest(22));
      expect(
        (await fetchDepositAccount(rpc(), depositAccount)).data,
      ).toMatchObject({ available: before, locked: 0n });
      await expect(
        send(operator, [
          await getResolveDisputeInstructionAsync({
            operator,
            passport,
            depositAccount,
            merchant: merchantAccount,
            rentalLock,
            vault,
            outcome: 0,
            resolutionDigest: digest(22),
          }),
        ]),
      ).rejects.toThrow();
    }, 60_000);

    it("pays the merchant the exact USDC deposit and rejects duplicate arbitration", async () => {
      const rentalLock = await lock(15n * USDC);
      const merchantBefore = (await fetchToken(rpc(), merchantToken)).data.amount;
      const vaultBefore = (await fetchToken(rpc(), vault)).data.amount;
      await send(merchant, [
        await getOpenDisputeInstructionAsync({
          merchantSigner: merchant,
          rentalLock,
          passport,
          depositAccount,
          evidenceDigest: digest(31),
        }),
      ]);

      await expect(
        send(operator, [
          await getResolveDisputeInstructionAsync({
            operator,
            passport,
            depositAccount,
            merchant: merchantAccount,
            rentalLock,
            vault,
            outcome: 1,
            resolutionDigest: digest(32),
          }),
        ]),
      ).rejects.toThrow();
      await send(operator, [
        await getResolveDisputeInstructionAsync({
          operator,
          passport,
          depositAccount,
          merchant: merchantAccount,
          rentalLock,
          vault,
          merchantToken,
          outcome: 1,
          resolutionDigest: digest(32),
        }),
      ]);

      const resolved = await fetchRentalLock(rpc(), rentalLock);
      expect(resolved.data.status).toBe(4);
      expect((await fetchToken(rpc(), merchantToken)).data.amount).toBe(
        merchantBefore + 15n * USDC,
      );
      expect((await fetchToken(rpc(), vault)).data.amount).toBe(
        vaultBefore - 15n * USDC,
      );
      expect(
        (await fetchDepositAccount(rpc(), depositAccount)).data.locked,
      ).toBe(0n);
      await expect(
        send(operator, [
          await getResolveDisputeInstructionAsync({
            operator,
            passport,
            depositAccount,
            merchant: merchantAccount,
            rentalLock,
            vault,
            merchantToken,
            outcome: 1,
            resolutionDigest: digest(32),
          }),
        ]),
      ).rejects.toThrow();
    }, 60_000);

    it("rejects stale nonces and a second lock, then keeper releases at exactly 180 days", async () => {
      const firstPassport = await fetchDepositPassport(rpc(), passport);
      await expect(
        send(guest, [
          await getAuthorizeRentalInstructionAsync({
            owner: guest,
            merchant: merchantAccount,
            depositAccount,
            amount: 1n * USDC,
            itemId: "stale-nonce",
            dueAt: (await currentTimestamp()) + DAY,
            nonce: firstPassport.data.nextNonce + 100n,
            rulesVersion: 2,
          }),
        ]),
      ).rejects.toThrow();

      const rentalLock = await lock(10n * USDC);
      const started = (await fetchRentalLock(rpc(), rentalLock)).data.startedAt;
      await expect(
        send(guest, [await authorize(1n * USDC)]),
      ).rejects.toThrow();

      net.timeTravelToTimestamp(Number(started + 180n * DAY - 1n) * 1000);
      await expect(
        send(outsider, [
          getKeeperReleaseInstruction({
            keeper: outsider,
            passport,
            depositAccount,
            rentalLock,
          }),
        ]),
      ).rejects.toThrow();
      net.timeTravelToTimestamp(Number(started + 180n * DAY) * 1000);
      await send(outsider, [
        getKeeperReleaseInstruction({
          keeper: outsider,
          passport,
          depositAccount,
          rentalLock,
        }),
      ]);
      expect((await fetchRentalLock(rpc(), rentalLock)).data.status).toBe(5);
      await expect(
        send(outsider, [
          getKeeperReleaseInstruction({
            keeper: outsider,
            passport,
            depositAccount,
            rentalLock,
          }),
        ]),
      ).rejects.toThrow();
    }, 90_000);
  },
);
