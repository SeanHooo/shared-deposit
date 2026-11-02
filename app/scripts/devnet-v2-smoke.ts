/**
 * Dry-runs the first v2 devnet platform and 1 USDC deposit transaction.
 *
 * Usage:
 *   SOLANA_DEVNET_RPC_URL=... npm exec -- tsx scripts/devnet-v2-smoke.ts
 *   SOLANA_DEVNET_RPC_URL=... npm exec -- tsx scripts/devnet-v2-smoke.ts --send
 *
 * The default mode never reads a keypair or signs. `--send` must only be used
 * after a human has reviewed the dry-run output and explicitly approved it.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createKeyPairSignerFromBytes,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  estimateAndSetResourceLimitsFactory,
  estimateResourceLimitsFactory,
  getAddressDecoder,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signature,
  signTransactionMessageWithSigners,
  type Address,
  type TransactionSigner,
} from "@solana/kit";
import {
  getMintDecoder,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  getDepositAccountDecoder,
  getDepositPassportDecoder,
  getInitializePlatformInstructionAsync,
  getPlatformDecoder,
} from "../src/generated-v2";
import {
  balanceInstructionsV2,
  depositAddressV2,
  passportAddressV2,
  platformAddressV2,
  PROGRAM_ADDRESS_V2,
  tokenAddressV2,
  USDC_UNIT_V2,
} from "../src/program-v2";

const DEVNET_GENESIS_HASH =
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" as const;
const PROGRAM_DATA = address(
  "CiCGcKQuP4dnacBAww36r4fAD14NWNSF31fvbqXBxTxB",
);
const OPERATOR = address("CMNgjVqaaopNCZTsKBzD2zVxxQHMrFejNiaQW9iVXrxF");
const USDC_MINT = address("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const LOADER = address("BPFLoaderUpgradeab1e11111111111111111111111");
const DEPOSIT_RAW = USDC_UNIT_V2;
const RPC_URL =
  process.env.SOLANA_DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
const SEND = process.argv.includes("--send");

const rpc = createSolanaRpc(RPC_URL);

function sameAddress(left: Address, right: Address) {
  return left === right;
}

function asBytes(base64: string) {
  return new Uint8Array(getBase64Encoder().encode(base64));
}

function requireAccount<T>(
  account: { value: T | null } | null | undefined,
  label: string,
): T {
  if (account?.value == null)
    throw new Error(`${label} account was not found.`);
  return account.value;
}

async function assertDevnetAndProgram() {
  const genesisHash = await rpc.getGenesisHash().send();
  if (genesisHash !== DEVNET_GENESIS_HASH) {
    throw new Error(`Refusing non-devnet genesis hash: ${genesisHash}`);
  }

  const [program, programData] = await Promise.all([
    rpc
      .getAccountInfo(PROGRAM_ADDRESS_V2, {
        encoding: "base64",
        commitment: "confirmed",
      })
      .send(),
    rpc
      .getAccountInfo(PROGRAM_DATA, {
        encoding: "base64",
        commitment: "confirmed",
      })
      .send(),
  ]);
  const deployedProgram = requireAccount(program, "v2 program");
  const deployedProgramData = requireAccount(programData, "v2 program data");
  if (
    !deployedProgram.executable ||
    deployedProgram.owner !== LOADER ||
    deployedProgramData.owner !== LOADER
  ) {
    throw new Error("The v2 program ownership or executable flag is invalid.");
  }

  const bytes = asBytes(deployedProgramData.data[0]);
  if (bytes.length < 45 || bytes[12] !== 1) {
    throw new Error("The v2 program upgrade authority is not set.");
  }
  const authority = getAddressDecoder().decode(bytes.slice(13, 45));
  if (!sameAddress(authority, OPERATOR)) {
    throw new Error("The configured operator is not the upgrade authority.");
  }
}

async function assertOfficialUsdc() {
  const account = await rpc
    .getAccountInfo(USDC_MINT, {
      encoding: "base64",
      commitment: "confirmed",
    })
    .send();
  const mintAccount = requireAccount(account, "official devnet USDC mint");
  if (mintAccount.owner !== TOKEN_PROGRAM_ADDRESS) {
    throw new Error("The official devnet USDC mint is not owned by SPL Token.");
  }
  const bytes = asBytes(mintAccount.data[0]);
  const mint = getMintDecoder().decode(bytes);
  if (!mint.isInitialized || mint.decimals !== 6) {
    throw new Error("The official devnet USDC mint is not initialized with 6 decimals.");
  }
}

async function accountExists(account: Address) {
  return (
    await rpc
      .getAccountInfo(account, {
        encoding: "base64",
        commitment: "confirmed",
      })
      .send()
  ).value !== null;
}

async function assertPreparedAccountsAbsent(accounts: {
  platform: Address;
  passport: Address;
  deposit: Address;
  vault: Address;
}) {
  const entries = Object.entries(accounts) as [string, Address][];
  const existing = (
    await Promise.all(
      entries.map(async ([label, account]) => ({
        label,
        exists: await accountExists(account),
      })),
    )
  ).filter((entry) => entry.exists);
  if (existing.length > 0) {
    throw new Error(
      `Refusing to overwrite initialized accounts: ${existing
        .map((entry) => `${entry.label}=${accounts[entry.label as keyof typeof accounts]}`)
        .join(", ")}`,
    );
  }
}

async function assertUsdcBalance(ownerToken: Address) {
  let balance;
  try {
    balance = (
      await rpc
        .getTokenAccountBalance(ownerToken, { commitment: "confirmed" })
        .send()
    ).value;
  } catch {
    throw new Error(
      `The operator has no official devnet USDC ATA: ${ownerToken}`,
    );
  }
  if (BigInt(balance.amount) < DEPOSIT_RAW) {
    throw new Error(
      `The operator has ${balance.uiAmountString} devnet USDC; 1 USDC is required.`,
    );
  }
  return balance;
}

async function loadSigner(): Promise<TransactionSigner> {
  if (!SEND) return createNoopSigner(OPERATOR);

  const keypairPath =
    process.env.SOLANA_KEYPAIR_PATH ?? `${homedir()}/.config/solana/id.json`;
  const parsed = JSON.parse(readFileSync(keypairPath, "utf8")) as number[];
  const signer = await createKeyPairSignerFromBytes(
    Uint8Array.from(parsed),
  );
  if (!sameAddress(signer.address, OPERATOR)) {
    throw new Error("The local keypair does not match the deployment operator.");
  }
  return signer;
}

async function rentExemptions() {
  const sizes = {
    platform: 73n,
    passport: 81n,
    deposit: 121n,
    vault: 165n,
  } as const;
  const entries = await Promise.all(
    Object.entries(sizes).map(async ([label, space]) => [
      label,
      (
        await rpc
          .getMinimumBalanceForRentExemption(space, {
            commitment: "confirmed",
          })
          .send()
      ).toString(),
    ]),
  );
  const values = Object.fromEntries(entries) as Record<
    keyof typeof sizes,
    string
  >;
  return {
    ...values,
    totalLamports: Object.values(values)
      .reduce((sum, value) => sum + BigInt(value), 0n)
      .toString(),
  };
}

async function verifyInitialized(
  platform: Address,
  passport: Address,
  deposit: Address,
  vault: Address,
) {
  const [platformInfo, passportInfo, depositInfo, vaultBalance] =
    await Promise.all([
      rpc
        .getAccountInfo(platform, {
          encoding: "base64",
          commitment: "confirmed",
        })
        .send(),
      rpc
        .getAccountInfo(passport, {
          encoding: "base64",
          commitment: "confirmed",
        })
        .send(),
      rpc
        .getAccountInfo(deposit, {
          encoding: "base64",
          commitment: "confirmed",
        })
        .send(),
      rpc
        .getTokenAccountBalance(vault, { commitment: "confirmed" })
        .send(),
    ]);

  const platformData = getPlatformDecoder().decode(
    asBytes(requireAccount(platformInfo, "platform").data[0]),
  );
  const passportData = getDepositPassportDecoder().decode(
    asBytes(requireAccount(passportInfo, "passport").data[0]),
  );
  const depositData = getDepositAccountDecoder().decode(
    asBytes(requireAccount(depositInfo, "deposit").data[0]),
  );
  if (
    platformData.operator !== OPERATOR ||
    platformData.usdcMint !== USDC_MINT ||
    passportData.owner !== OPERATOR ||
    depositData.owner !== OPERATOR ||
    depositData.available !== DEPOSIT_RAW ||
    depositData.locked !== 0n ||
    vaultBalance.value.amount !== DEPOSIT_RAW.toString()
  ) {
    throw new Error("The initialized v2 account state does not match the deposit.");
  }
  return {
    platform: {
      operator: platformData.operator,
      usdcMint: platformData.usdcMint,
    },
    passport: {
      owner: passportData.owner,
      nextNonce: passportData.nextNonce.toString(),
    },
    deposit: {
      available: depositData.available.toString(),
      locked: depositData.locked.toString(),
    },
    vault: {
      amount: vaultBalance.value.amount,
      uiAmountString: vaultBalance.value.uiAmountString,
    },
  };
}

async function main() {
  console.log(
    JSON.stringify(
      {
        mode: SEND ? "SEND" : "SIMULATE_ONLY",
        rpcHost: new URL(RPC_URL).host,
        expectedGenesisHash: DEVNET_GENESIS_HASH,
        operator: OPERATOR,
        program: PROGRAM_ADDRESS_V2,
        usdcMint: USDC_MINT,
        depositRaw: DEPOSIT_RAW.toString(),
      },
      null,
      2,
    ),
  );

  await assertDevnetAndProgram();
  await assertOfficialUsdc();

  const [platform, passport, deposit, vault, ownerToken] = await Promise.all([
    platformAddressV2(),
    passportAddressV2(OPERATOR),
    depositAddressV2(OPERATOR, USDC_MINT),
    depositAddressV2(OPERATOR, USDC_MINT).then((owner) =>
      tokenAddressV2(owner, USDC_MINT),
    ),
    tokenAddressV2(OPERATOR, USDC_MINT),
  ]);
  const preparedAccounts = { platform, passport, deposit, vault };
  await assertPreparedAccountsAbsent(preparedAccounts);
  const usdcBalance = await assertUsdcBalance(ownerToken);
  const operatorSol = (await rpc.getBalance(OPERATOR).send()).value;
  if (operatorSol < 10_000_000n) {
    throw new Error("The operator has less than 0.01 SOL for rent and fees.");
  }

  const signer = await loadSigner();
  const instructions = [
    await getInitializePlatformInstructionAsync({
      operator: signer,
      programData: PROGRAM_DATA,
      usdcMint: USDC_MINT,
    }),
    ...(await balanceInstructionsV2(
      signer,
      USDC_MINT,
      DEPOSIT_RAW,
      "deposit",
      true,
      true,
    )),
  ];
  const { value: latestBlockhash } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();
  const initialMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (message) => setTransactionMessageFeePayerSigner(signer, message),
    (message) =>
      appendTransactionMessageInstructions(instructions, message),
    (message) =>
      setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, message),
  );
  const estimateResourceLimits = estimateResourceLimitsFactory({ rpc });
  const message = await estimateAndSetResourceLimitsFactory(
    async (transactionMessage, config) => {
      const limits = await estimateResourceLimits(transactionMessage, config);
      return {
        ...limits,
        computeUnitLimit:
          Math.ceil(limits.computeUnitLimit * 1.1) + 300,
      };
    },
  )(initialMessage);

  const compiled = compileTransaction(message);
  const simulation = await rpc
    .simulateTransaction(getBase64EncodedWireTransaction(compiled), {
      encoding: "base64",
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
    })
    .send();
  if (simulation.value.err) {
    throw new Error(
      `Simulation failed: ${JSON.stringify(simulation.value.err)}\n${(
        simulation.value.logs ?? []
      )
        .slice(-12)
        .join("\n")}`,
    );
  }

  const messageBytes = getBase64Decoder().decode(
    compiled.messageBytes,
  ) as Parameters<typeof rpc.getFeeForMessage>[0];
  const fee = (await rpc.getFeeForMessage(messageBytes).send()).value;
  if (fee === null) throw new Error("The transaction fee is unavailable.");
  const rent = await rentExemptions();

  const summary = {
    mode: SEND ? "SEND" : "SIMULATE_ONLY",
    cluster: "solana-devnet",
    operator: OPERATOR,
    feePayer: OPERATOR,
    program: PROGRAM_ADDRESS_V2,
    programData: PROGRAM_DATA,
    usdcMint: USDC_MINT,
    ownerToken,
    amount: {
      raw: DEPOSIT_RAW.toString(),
      ui: "1 USDC",
    },
    accounts: preparedAccounts,
    operatorSolLamports: operatorSol.toString(),
    operatorUsdc: {
      raw: usdcBalance.amount,
      ui: usdcBalance.uiAmountString,
    },
    rentExemptionLamports: rent,
    estimatedFeeLamports: fee.toString(),
    simulation: {
      error: simulation.value.err,
      unitsConsumed: simulation.value.unitsConsumed?.toString() ?? null,
      logs: (simulation.value.logs ?? []).slice(-8),
    },
    actions: [
      "initialize v2 platform with official devnet USDC",
      "initialize operator passport",
      "initialize operator USDC deposit account and vault",
      "transfer exactly 1 devnet USDC from operator ATA to deposit vault",
    ],
  };
  console.log(JSON.stringify(summary, null, 2));

  if (!SEND) {
    console.log("\nNo keypair was read, nothing was signed, and nothing was sent.");
    return;
  }

  await assertPreparedAccountsAbsent(preparedAccounts);
  const signedTransaction = await signTransactionMessageWithSigners(message);
  const txSignature = getSignatureFromTransaction(signedTransaction);
  await rpc
    .sendTransaction(getBase64EncodedWireTransaction(signedTransaction), {
      encoding: "base64",
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 2n,
    })
    .send();

  let confirmed = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = (
      await rpc
        .getSignatureStatuses([signature(txSignature)], {
          searchTransactionHistory: true,
        })
        .send()
    ).value[0];
    if (status?.err) {
      throw new Error(
        `Transaction failed: ${JSON.stringify(status.err)} (${txSignature})`,
      );
    }
    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    ) {
      confirmed = true;
      break;
    }
    const blockHeight = await rpc.getBlockHeight().send();
    if (blockHeight > latestBlockhash.lastValidBlockHeight) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (!confirmed) {
    throw new Error(`Transaction was not confirmed in time: ${txSignature}`);
  }

  const verified = await verifyInitialized(
    platform,
    passport,
    deposit,
    vault,
  );
  console.log(
    JSON.stringify(
      {
        status: "confirmed",
        signature: txSignature,
        verified,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
