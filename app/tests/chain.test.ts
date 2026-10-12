import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Surfnet } from "@solana/surfpool";
import {
  address,
  getAddressEncoder,
  getBase64Encoder,
  createClient,
  createKeyPairSignerFromBytes,
  generateKeyPairSigner,
  none,
  some,
  type KeyPairSigner,
  type Instruction,
} from "@solana/kit";
import { signer } from "@solana/kit-plugin-signer";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import {
  fetchToken,
  getMintEncoder,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import * as p from "../src/program";
import { loadSnapshot, loadHistory, makeRpc } from "../src/chain";

describe.sequential(
  "SBF Passport on offline Surfpool (real signatures and token CPI)",
  () => {
    let net: Surfnet;
    let operator: KeyPairSigner,
      guest: KeyPairSigner,
      merchant: KeyPairSigner,
      merchant2: KeyPairSigner,
      outsider: KeyPairSigner;
    let usdc: ReturnType<typeof address>, usdt: ReturnType<typeof address>;
    const rpc = () => makeRpc(net.rpcUrl);
    const snapshot = () => loadSnapshot(rpc());
    const send = async (who: KeyPairSigner, instructions: Instruction[]) => {
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
        abortSignal: AbortSignal.timeout(15000),
      });
    };
    const deposit = async (
      mint: ReturnType<typeof address>,
      amount: bigint,
    ) => {
      const state = await snapshot();
      const account = await p.depositAddress(guest.address, mint);
      return send(
        guest,
        await p.balanceInstructions(
          guest,
          mint,
          amount,
          "deposit",
          !state.passports.some((e) => e.data.owner === guest.address),
          !state.deposits.some((e) => e.address === account),
        ),
      );
    };
    const authorize = async (
      mint = usdc,
      amount = 5_000_000n,
      who = merchant,
      due?: bigint,
    ) => {
      const state = await snapshot();
      const passport = state.passports.find(
        (e) => e.data.owner === guest.address,
      )!;
      const authorization = await p.authorizationAddress(
        passport.address,
        passport.data.nextNonce,
      );
      const depositAccount = await p.depositAddress(guest.address, mint);
      const merchantAccount = await p.merchantAddress(who.address);
      await send(guest, [
        p.getAuthorizeRentalInstruction({
          owner: guest,
          passport: passport.address,
          merchant: merchantAccount,
          depositAccount,
          authorization,
          amount,
          itemId: "bike-042",
          dueAt: due ?? state.timestamp + 86400n,
          nonce: passport.data.nextNonce,
          rulesVersion: 1,
        }),
      ]);
      return {
        authorization,
        depositAccount,
        passport: passport.address,
        merchant: merchantAccount,
        nonce: passport.data.nextNonce,
      };
    };
    const lock = async (
      auth: Awaited<ReturnType<typeof authorize>>,
      who = merchant,
    ) => {
      const rentalLock = await p.rentalAddress(auth.passport, auth.nonce);
      await send(who, [
        p.getLockDepositInstruction({
          ...auth,
          merchantSigner: who,
          rentalLock,
        }),
      ]);
      return {
        passport: auth.passport,
        depositAccount: auth.depositAccount,
        merchant: auth.merchant,
        rentalLock,
      };
    };
    beforeAll(async () => {
      net = Surfnet.startWithConfig({
        offline: true,
        blockProductionMode: "clock",
        slotTimeMs: 100,
      });
      // Synthetic test signers only, never read user keypair files.
      operator = await createKeyPairSignerFromBytes(net.payerSecretKey);
      [guest, merchant, merchant2, outsider] = await Promise.all(
        Array.from({ length: 4 }, () => generateKeyPairSigner()),
      );
      for (const who of [guest, merchant, merchant2, outsider])
        net.fundSol(who.address, 10_000_000_000);
      net.deploy({
        programId: p.PROGRAM_ADDRESS,
        soPath: "../target/deploy/shared_deposit_passport.so",
      });
      // Native deployment has no authority; model an operator-owned upgradeable deployment.
      const programData = await p.programDataAddress();
      const deployed = (
        await rpc().getAccountInfo(programData, { encoding: "base64" }).send()
      ).value!;
      const deployedBytes = new Uint8Array(
        getBase64Encoder().encode(deployed.data[0]),
      );
      deployedBytes[12] = 1;
      deployedBytes.set(getAddressEncoder().encode(operator.address), 13);
      net.setAccount(
        programData,
        Number(deployed.lamports),
        deployedBytes,
        deployed.owner,
      );
      [usdc, usdt] = await Promise.all(
        Array.from(
          { length: 2 },
          async () => (await generateKeyPairSigner()).address,
        ),
      );
      for (const mint of [usdc, usdt]) {
        const data = getMintEncoder().encode({
          decimals: 6,
          supply: 1_000_000_000n,
          isInitialized: true,
          mintAuthority: some(operator.address),
          freezeAuthority: none(),
        });
        net.setAccount(
          mint,
          1_461_600,
          new Uint8Array(data),
          TOKEN_PROGRAM_ADDRESS,
        );
        net.fundToken(guest.address, mint, 100_000_000);
      }
      const init = p.getInitializePlatformInstruction({
        operator,
        programData: await p.programDataAddress(),
        usdcMint: usdc,
        usdtMint: usdt,
        platform: await p.platformAddress(),
      });
      await expect(
        send(outsider, [
          p.getInitializePlatformInstruction({
            operator: outsider,
            programData: await p.programDataAddress(),
            usdcMint: usdc,
            usdtMint: usdt,
            platform: await p.platformAddress(),
          }),
        ]),
      ).rejects.toThrow();
      await send(operator, [init]);
      for (const [who, name] of [
        [merchant, "Bike shop"],
        [merchant2, "Camping shop"],
      ] as const) {
        await send(operator, [
          p.getRegisterMerchantInstruction({
            operator,
            platform: await p.platformAddress(),
            merchantKey: who.address,
            merchant: await p.merchantAddress(who.address),
            name,
          }),
        ]);
      }
    }, 60000);
    afterAll(() => net?.stop());

    it("three assets deposit; return to Passport, rent again at another merchant, withdraw actual tokens", async () => {
      for (const mint of [usdc, usdt, p.ZERO])
        await deposit(mint, mint === p.ZERO ? 100_000_000n : 20_000_000n);
      for (const mint of [usdc, usdt, p.ZERO]) {
        const amount = mint === p.ZERO ? 20_000_000n : 5_000_000n;
        const auth = await authorize(mint, amount);
        const rental = await lock(auth);
        const state = await snapshot();
        expect(
          state.deposits.find((e) => e.address === rental.depositAccount)!.data
            .locked,
        ).toBe(amount);
        await send(merchant, [
          p.getRecordReturnInstruction({
            ...rental,
            merchantSigner: merchant,
            returnStatus: 0,
            photoUrl: "https://example.com/return.jpg",
            photoHash: new Uint8Array(32).fill(7),
          }),
        ]);
        await expect(
          send(merchant, [
            p.getRecordReturnInstruction({
              ...rental,
              merchantSigner: merchant,
              returnStatus: 0,
              photoUrl: "",
              photoHash: new Uint8Array(32),
            }),
          ]),
        ).rejects.toThrow();
        const returned = (await snapshot()).rentals.find(
          (e) => e.address === rental.rentalLock,
        )!.data;
        expect(returned.returnedAt).toBeGreaterThan(0n);
        expect(returned.photoUrl).toBe("https://example.com/return.jpg");
        expect(returned.status).toBe(1);
        const again = await lock(
          await authorize(mint, amount, merchant2),
          merchant2,
        );
        await send(merchant2, [
          p.getRecordReturnInstruction({
            ...again,
            merchantSigner: merchant2,
            returnStatus: 0,
            photoUrl: "",
            photoHash: new Uint8Array(32),
          }),
        ]);
        const available = (await snapshot()).deposits.find(
          (e) => e.address === again.depositAccount,
        )!.data.available;
        await send(
          guest,
          await p.balanceInstructions(
            guest,
            mint,
            available,
            "withdraw",
            false,
            false,
          ),
        );
        expect(
          (await snapshot()).deposits.find(
            (e) => e.address === again.depositAccount,
          )!.data.available,
        ).toBe(0n);
        if (mint !== p.ZERO)
          expect(
            (await fetchToken(rpc(), await p.tokenAddress(guest.address, mint)))
              .data.amount,
          ).toBe(100_000_000n);
        await deposit(mint, mint === p.ZERO ? 100_000_000n : 20_000_000n);
      }
    }, 120000);

    it("enforces minimum reserve, merchant allowlist, bound asset, nonce, revocation and permissions", async () => {
      await expect(authorize(usdc, 20_000_000n)).rejects.toThrow();
      const auth = await authorize();
      await expect(lock(auth, outsider)).rejects.toThrow();
      await expect(
        lock({
          ...auth,
          depositAccount: await p.depositAddress(guest.address, usdt),
        }),
      ).rejects.toThrow();
      await send(guest, [
        p.getRevokeAuthorizationInstruction({ owner: guest, ...auth }),
      ]);
      await expect(lock(auth)).rejects.toThrow();
      await send(operator, [
        p.getSetMerchantActiveInstruction({
          operator,
          platform: await p.platformAddress(),
          merchant: await p.merchantAddress(merchant.address),
          active: false,
        }),
      ]);
      await expect(authorize()).rejects.toThrow();
      await send(operator, [
        p.getSetMerchantActiveInstruction({
          operator,
          platform: await p.platformAddress(),
          merchant: await p.merchantAddress(merchant.address),
          active: true,
        }),
      ]);
      await expect(
        send(outsider, [
          p.getSetMerchantActiveInstruction({
            operator: outsider,
            platform: await p.platformAddress(),
            merchant: await p.merchantAddress(merchant.address),
            active: false,
          }),
        ]),
      ).rejects.toThrow();
    }, 60000);

    it("rejects concurrent locks/top-ups and allows withdrawal of another unlocked asset", async () => {
      const auth = await authorize();
      const other = await authorize(usdt, 5_000_000n, merchant2);
      const rental = await lock(auth);
      await expect(lock(auth)).rejects.toThrow();
      await expect(lock(other, merchant2)).rejects.toThrow();
      await expect(deposit(usdc, 1_000_000n)).rejects.toThrow();
      await expect(
        send(
          guest,
          await p.balanceInstructions(
            guest,
            usdc,
            1_000_000n,
            "withdraw",
            false,
            false,
          ),
        ),
      ).rejects.toThrow();
      await send(
        guest,
        await p.balanceInstructions(
          guest,
          usdt,
          1_000_000n,
          "withdraw",
          false,
          false,
        ),
      );
      await expect(
        send(outsider, [
          p.getRecordReturnInstruction({
            ...rental,
            merchantSigner: outsider,
            returnStatus: 0,
            photoUrl: "",
            photoHash: new Uint8Array(32),
          }),
        ]),
      ).rejects.toThrow();
      await send(merchant, [
        p.getRecordReturnInstruction({
          ...rental,
          merchantSigner: merchant,
          returnStatus: 0,
          photoUrl: "",
          photoHash: new Uint8Array(32),
        }),
      ]);
    }, 60000);

    it("damage/missing freeze indefinitely, only original merchant compensation unfreezes", async () => {
      for (const returnStatus of [1, 2]) {
        const rental = await lock(await authorize());
        await send(merchant, [
          p.getRecordReturnInstruction({
            ...rental,
            merchantSigner: merchant,
            returnStatus,
            photoUrl: "",
            photoHash: new Uint8Array(32),
          }),
        ]);
        const before = (await snapshot()).deposits.find(
          (e) => e.address === rental.depositAccount,
        )!.data;
        net.timeTravelToTimestamp(
          (Number((await snapshot()).timestamp) + 181 * 86400) * 1000,
        );
        await expect(
          send(operator, [
            p.getKeeperReleaseInstruction({ ...rental, keeper: operator }),
          ]),
        ).rejects.toThrow();
        await expect(
          send(merchant2, [
            p.getConfirmCompensatedInstruction({
              ...rental,
              merchantSigner: merchant2,
            }),
          ]),
        ).rejects.toThrow();
        await send(merchant, [
          p.getConfirmCompensatedInstruction({
            ...rental,
            merchantSigner: merchant,
          }),
        ]);
        const after = (await snapshot()).deposits.find(
          (e) => e.address === rental.depositAccount,
        )!.data;
        expect(after.available).toBe(before.available + before.locked);
        expect(after.locked).toBe(0n);
        expect(after.frozen).toBe(false);
        await expect(
          send(merchant, [
            p.getConfirmCompensatedInstruction({
              ...rental,
              merchantSigner: merchant,
            }),
          ]),
        ).rejects.toThrow();
      }
    }, 90000);

    it("keeper enforces exact 180-day threshold, cannot duplicate, and never takes deposit funds", async () => {
      const rental = await lock(await authorize(p.ZERO, 20_000_000n));
      const state = await snapshot();
      const started = state.rentals.find(
        (e) => e.address === rental.rentalLock,
      )!.data.startedAt;
      net.timeTravelToTimestamp(Number(started + 180n * 86400n - 2n) * 1000);
      await expect(
        send(operator, [
          p.getKeeperReleaseInstruction({ ...rental, keeper: operator }),
        ]),
      ).rejects.toThrow();
      net.timeTravelToTimestamp(Number(started + 180n * 86400n) * 1000);
      const vaultBefore = (await rpc().getBalance(rental.depositAccount).send())
        .value;
      await send(operator, [
        p.getKeeperReleaseInstruction({ ...rental, keeper: operator }),
      ]);
      expect((await rpc().getBalance(rental.depositAccount).send()).value).toBe(
        vaultBefore,
      );
      expect(
        (await snapshot()).rentals.find((e) => e.address === rental.rentalLock)!
          .data.status,
      ).toBe(4);
      await expect(
        send(operator, [
          p.getKeeperReleaseInstruction({ ...rental, keeper: operator }),
        ]),
      ).rejects.toThrow();
    }, 60000);

    it("rejects expired authorization; history is recoverable directly from chain", async () => {
      const state = await snapshot();
      const auth = await authorize(
        usdc,
        1_000_000n,
        merchant,
        state.timestamp + 400n * 86400n,
      );
      net.timeTravelToTimestamp(Number(state.timestamp + 366n * 86400n) * 1000);
      await expect(lock(auth)).rejects.toThrow();
      const history = await loadHistory(
        rpc(),
        await p.passportAddress(guest.address),
      );
      expect(history.rows.some((e) => e.owner === guest.address)).toBe(true);
    }, 60000);

    it("validates foreign mint, exact reserve, zero amounts, input bytes and due dates", async () => {
      const foreign = (await generateKeyPairSigner()).address;
      net.setAccount(
        foreign,
        1_461_600,
        new Uint8Array(
          getMintEncoder().encode({
            decimals: 6,
            supply: 100n,
            isInitialized: true,
            mintAuthority: none(),
            freezeAuthority: none(),
          }),
        ),
        TOKEN_PROGRAM_ADDRESS,
      );
      await expect(deposit(foreign, 1n)).rejects.toThrow();
      await expect(deposit(usdc, 0n)).rejects.toThrow();
      const state = await snapshot();
      const balance = state.deposits.find(
        (d) => d.data.owner === guest.address && d.data.mint === usdc,
      )!.data.available;
      await expect(authorize(usdc, balance - 999_999n)).rejects.toThrow();
      const valid = await authorize(usdc, balance - 1_000_000n);
      const rental = await lock(valid);
      await expect(
        send(merchant, [
          p.getRecordReturnInstruction({
            ...rental,
            merchantSigner: merchant,
            returnStatus: 3,
            photoUrl: "",
            photoHash: new Uint8Array(32),
          }),
        ]),
      ).rejects.toThrow();
      await expect(
        send(merchant, [
          p.getRecordReturnInstruction({
            ...rental,
            merchantSigner: merchant,
            returnStatus: 0,
            photoUrl: "http://example.com/photo.jpg",
            photoHash: new Uint8Array(32),
          }),
        ]),
      ).rejects.toThrow();
      await send(merchant, [
        p.getRecordReturnInstruction({
          ...rental,
          merchantSigner: merchant,
          returnStatus: 0,
          photoUrl: "",
          photoHash: new Uint8Array(32),
        }),
      ]);
      await expect(
        authorize(usdc, 1n, merchant, state.timestamp - 1n),
      ).rejects.toThrow();
    }, 60000);
  },
);
