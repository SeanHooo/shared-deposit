import {
  compileTransaction,
  createClient,
  getBase64EncodedWireTransaction,
  getBase64Decoder,
  getSignatureFromTransaction,
  signature,
  setTransactionMessageLifetimeUsingBlockhash,
  isTransactionModifyingSigner,
  isTransactionPartialSigner,
  estimateAndSetResourceLimitsFactory,
  estimateResourceLimitsFactory,
  type Base64EncodedWireTransaction,
  type Instruction,
  type TransactionSigner,
  type TransactionMessageBytesBase64,
} from "@solana/kit";
import { signer } from "@solana/kit-plugin-signer";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { assertNetwork, makeRpc } from "./chain";
import { formatAmount } from "./program";
export const RPC_URL =
  import.meta.env.VITE_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
export const LOCAL =
  import.meta.env.VITE_LOCALNET === "true" &&
  ["localhost", "127.0.0.1", "[::1]"].includes(new URL(RPC_URL).hostname);
const storageKey = `passport:pending:${RPC_URL}`;
export type Pending = {
  signature: string;
  wire: string;
  lastValidBlockHeight: string;
  owner: string;
  summary: string;
};
export function pendingTransaction(): Pending | null {
  const raw = localStorage.getItem(storageKey);
  return raw ? JSON.parse(raw) : null;
}
export async function resolvePending(resend = false): Promise<string> {
  const pending = pendingTransaction();
  if (!pending) return "No unresolved transaction.";
  const rpc = makeRpc(RPC_URL);
  await assertNetwork(rpc, LOCAL);
  const status = (
    await rpc
      .getSignatureStatuses([signature(pending.signature)], {
        searchTransactionHistory: true,
      })
      .send()
  ).value[0];
  if (status?.err) {
    localStorage.removeItem(storageKey);
    throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
  }
  if (
    status?.confirmationStatus === "confirmed" ||
    status?.confirmationStatus === "finalized"
  ) {
    localStorage.removeItem(storageKey);
    return `Confirmed on chain: ${pending.signature}`;
  }
  const height = await rpc.getBlockHeight({ commitment: "finalized" }).send();
  if (!status && height > BigInt(pending.lastValidBlockHeight)) {
    localStorage.removeItem(storageKey);
    return "The transaction expired without executing, so it can be submitted again.";
  }
  if (resend)
    await rpc
      .sendTransaction(pending.wire as Base64EncodedWireTransaction, {
        encoding: "base64",
        skipPreflight: false,
        maxRetries: 2n,
      })
      .send();
  return `Result unresolved; check or resend the same transaction: ${pending.signature}`;
}
export async function submitTransaction(
  who: TransactionSigner,
  instructions: Instruction[],
  summary: string,
  version: 0 | 1,
): Promise<string> {
  if (!isTransactionModifyingSigner(who) && !isTransactionPartialSigner(who))
    throw new Error(
      "This wallet only signs and sends, so an unresolved transaction cannot be stored safely. Use a wallet that supports signTransaction.",
    );
  if (pendingTransaction())
    throw new Error(
      "A previous transaction is unresolved. Check its result first to avoid a duplicate operation.",
    );
  const rpc = makeRpc(RPC_URL);
  await assertNetwork(rpc, LOCAL);
  const client = createClient()
    .use(signer(who))
    .use(solanaRpc({ rpcUrl: RPC_URL, transactionConfig: { version } }));
  const planned = await client.planTransaction(instructions);
  const withLifetime = setTransactionMessageLifetimeUsingBlockhash(
    (await rpc.getLatestBlockhash().send()).value,
    planned,
  );
  const estimate = estimateResourceLimitsFactory({ rpc });
  const message = await estimateAndSetResourceLimitsFactory(
    async (msg, config) => {
      const limits = await estimate(msg, config);
      return {
        ...limits,
        computeUnitLimit: Math.min(
          1400000,
          Math.ceil(limits.computeUnitLimit * 1.1) + 300,
        ),
      };
    },
  )(withLifetime);
  const simulation = await rpc
    .simulateTransaction(
      getBase64EncodedWireTransaction(compileTransaction(message)),
      { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true },
    )
    .send();
  if (simulation.value.err)
    throw new Error(
      `Simulation failed: ${(simulation.value.logs ?? []).slice(-6).join("\n")}`,
    );
  const fee = (
    await rpc
      .getFeeForMessage(
        getBase64Decoder().decode(
          compileTransaction(message).messageBytes,
        ) as TransactionMessageBytesBase64,
      )
      .send()
  ).value;
  if (fee === null)
    throw new Error(
      "The transaction fee cannot be confirmed yet; refresh and try again.",
    );
  if (
    !window.confirm(
      `${summary}\nNetwork: ${LOCAL ? "Localnet" : "Solana devnet"}\nProgram: ${instructions.at(-1)?.programAddress}\nSigning and fee payer: ${who.address}\nSimulation succeeded, ${simulation.value.unitsConsumed ?? "?"} CU consumed.\nEstimated network fee: ${formatAmount(fee, "SOL")} SOL. New accounts also need rent; the wallet confirms the final amount.\nConfirm to request a wallet signature.`,
    )
  )
    return "Cancelled. Nothing was signed or sent.";
  const signed = await client.signTransaction(message, {
    abortSignal: AbortSignal.timeout(60000),
  });
  const tx = signed.context,
    sig = tx.signature ?? getSignatureFromTransaction(tx.transaction);
  const pending: Pending = {
    signature: sig,
    wire: tx.transactionBase64,
    lastValidBlockHeight:
      tx.message.lifetimeConstraint.lastValidBlockHeight.toString(),
    owner: who.address,
    summary,
  };
  localStorage.setItem(storageKey, JSON.stringify(pending));
  await rpc
    .sendTransaction(tx.transactionBase64, {
      encoding: "base64",
      skipPreflight: false,
      maxRetries: 2n,
    })
    .send();
  for (let i = 0; i < 20; i++) {
    const result = await resolvePending();
    if (!pendingTransaction()) return result;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return `Submitted, result unresolved: ${sig}`;
}
