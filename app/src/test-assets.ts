// Devnet/localnet setup only. Mint account signers are ephemeral; wallet retains mint authority.
import {
  generateKeyPairSigner,
  type Address,
  type TransactionSigner,
} from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  getCreateAssociatedTokenIdempotentInstruction,
  getInitializeMint2Instruction,
  getMintToInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { type PassportRpc } from "./chain";
import { tokenAddress } from "./program";
export async function createTestMint(
  rpc: PassportRpc,
  operator: TransactionSigner,
) {
  const mint = await generateKeyPairSigner();
  const rent = await rpc.getMinimumBalanceForRentExemption(82n).send();
  return {
    address: mint.address,
    instructions: [
      getCreateAccountInstruction({
        payer: operator,
        newAccount: mint,
        lamports: rent,
        space: 82n,
        programAddress: TOKEN_PROGRAM_ADDRESS,
      }),
      getInitializeMint2Instruction({
        mint: mint.address,
        decimals: 6,
        mintAuthority: operator.address,
        freezeAuthority: null,
      }),
    ],
  };
}
export async function fundTestTokens(
  operator: TransactionSigner,
  mint: Address,
  recipient: Address,
  amount: bigint,
) {
  const token = await tokenAddress(recipient, mint);
  return [
    getCreateAssociatedTokenIdempotentInstruction({
      payer: operator,
      ata: token,
      owner: recipient,
      mint,
    }),
    getMintToInstruction({ mint, token, mintAuthority: operator, amount }),
  ];
}
