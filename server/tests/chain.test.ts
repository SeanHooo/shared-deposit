import { describe, expect, it } from "vitest";
import type { V2Rpc } from "../../app/src/chain-v2.js";
import {
  GENESIS_HASH_BY_CLUSTER,
  assertExpectedCluster,
} from "../src/chain.js";

function rpcReturning(genesisHash: string): Pick<V2Rpc, "getGenesisHash"> {
  return {
    getGenesisHash: () => ({
      send: async () => genesisHash,
    }),
  } as Pick<V2Rpc, "getGenesisHash">;
}

describe("Solana RPC cluster pinning", () => {
  it("pins the full 44-character devnet genesis hash", () => {
    expect(GENESIS_HASH_BY_CLUSTER.devnet).toBe(
      "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    );
    expect(GENESIS_HASH_BY_CLUSTER.devnet).toHaveLength(44);
  });

  it("accepts only the configured public cluster genesis hash", async () => {
    await expect(
      assertExpectedCluster(
        rpcReturning(GENESIS_HASH_BY_CLUSTER.devnet),
        "https://devnet.example.test/rpc",
        "devnet",
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertExpectedCluster(
        rpcReturning(GENESIS_HASH_BY_CLUSTER["mainnet-beta"]),
        "https://mainnet.example.test/rpc",
        "mainnet-beta",
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects a genesis-hash mismatch before reading program state", async () => {
    await expect(
      assertExpectedCluster(
        rpcReturning(GENESIS_HASH_BY_CLUSTER["mainnet-beta"]),
        "https://rpc.example.test",
        "devnet",
      ),
    ).rejects.toThrow("does not belong to the configured devnet cluster");
  });

  it("requires localnet endpoints to use loopback", async () => {
    await expect(
      assertExpectedCluster(
        rpcReturning("local-genesis"),
        "http://127.0.0.1:8899",
        "localnet",
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertExpectedCluster(
        rpcReturning("local-genesis"),
        "https://rpc.example.test",
        "localnet",
      ),
    ).rejects.toThrow("must resolve to loopback");
  });

  it("rejects credential-bearing and non-HTTP RPC URLs", async () => {
    await expect(
      assertExpectedCluster(
        rpcReturning(GENESIS_HASH_BY_CLUSTER.devnet),
        "https://user:secret@rpc.example.test",
        "devnet",
      ),
    ).rejects.toThrow("without credentials");
    await expect(
      assertExpectedCluster(
        rpcReturning(GENESIS_HASH_BY_CLUSTER.devnet),
        "ws://rpc.example.test",
        "devnet",
      ),
    ).rejects.toThrow("HTTP(S)");
  });
});
