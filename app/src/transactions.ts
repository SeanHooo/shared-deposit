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
  if (!pending) return "没有待确认交易。";
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
    throw new Error(`交易已失败：${JSON.stringify(status.err)}`);
  }
  if (
    status?.confirmationStatus === "confirmed" ||
    status?.confirmationStatus === "finalized"
  ) {
    localStorage.removeItem(storageKey);
    return `链上已确认：${pending.signature}`;
  }
  const height = await rpc.getBlockHeight({ commitment: "finalized" }).send();
  if (!status && height > BigInt(pending.lastValidBlockHeight)) {
    localStorage.removeItem(storageKey);
    return "交易已过期且链上未执行，可以重新发起。";
  }
  if (resend)
    await rpc
      .sendTransaction(pending.wire as Base64EncodedWireTransaction, {
        encoding: "base64",
        skipPreflight: false,
        maxRetries: 2n,
      })
      .send();
  return `结果待确认，请查询或重发同一笔交易：${pending.signature}`;
}
export async function submitTransaction(
  who: TransactionSigner,
  instructions: Instruction[],
  summary: string,
  version: 0 | 1,
): Promise<string> {
  if (!isTransactionModifyingSigner(who) && !isTransactionPartialSigner(who))
    throw new Error(
      "此钱包只支持签名并发送，无法安全保存待确认交易；请使用支持 signTransaction 的钱包。",
    );
  if (pendingTransaction())
    throw new Error("上一笔交易结果待确认，请先查询结果，避免重复操作。");
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
      `模拟失败：${(simulation.value.logs ?? []).slice(-6).join("\n")}`,
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
  if (fee === null) throw new Error("交易费用暂不可确认，请刷新后重试。");
  if (
    !window.confirm(
      `${summary}\n网络：${LOCAL ? "Localnet" : "Solana devnet"}\n程序：${instructions.at(-1)?.programAddress}\n签名及手续费钱包：${who.address}\n模拟成功，消耗 ${simulation.value.unitsConsumed ?? "?"} CU。\n预计网络费：${formatAmount(fee, "SOL")} SOL。新账户还需租金，实际金额由钱包确认。\n确认后请求钱包签名。`,
    )
  )
    return "已取消，未签名或发送。";
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
  return `已提交，结果待确认：${sig}`;
}
