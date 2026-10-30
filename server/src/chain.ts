import {
  address,
  type Address,
} from "@solana/kit";
import {
  loadV2Snapshot,
  makeV2Rpc,
  type V2Rpc,
  type V2Snapshot,
} from "../../app/src/chain-v2.js";
import { findMerchantPda, findPassportPda } from "../../app/src/generated-v2/index.js";
import { ChainUnavailableError } from "./errors.js";

export const GENESIS_HASH_BY_CLUSTER = {
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  "mainnet-beta": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
} as const;

export type ExpectedCluster = "localnet" | keyof typeof GENESIS_HASH_BY_CLUSTER;

export type Roles = {
  guest: boolean;
  merchant: boolean;
  operator: boolean;
  keeper: boolean;
};

export interface ChainGateway {
  load(): Promise<V2Snapshot>;
  lastSource(): string | null;
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "localhost." ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

function parseRpcUrl(rpcUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rpcUrl);
  } catch {
    throw new Error("Configured Solana RPC URL is invalid.");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("Solana RPC URL must be an HTTP(S) endpoint without credentials.");
  }
  return parsed;
}

function rpcHost(rpcUrl: string): string {
  try {
    return new URL(rpcUrl).host;
  } catch {
    return "invalid-endpoint";
  }
}

export async function assertExpectedCluster(
  rpc: Pick<V2Rpc, "getGenesisHash">,
  rpcUrl: string,
  expectedCluster?: string,
): Promise<void> {
  if (!expectedCluster) return;
  const parsed = parseRpcUrl(rpcUrl);
  if (expectedCluster === "localnet") {
    if (!isLoopbackHost(parsed.hostname)) {
      throw new Error("Localnet RPC endpoints must resolve to loopback.");
    }
    return;
  }
  const expectedHash =
    GENESIS_HASH_BY_CLUSTER[
      expectedCluster as keyof typeof GENESIS_HASH_BY_CLUSTER
    ];
  if (!expectedHash) {
    throw new Error(`Unsupported Solana cluster: ${expectedCluster}.`);
  }
  const actualHash = await rpc.getGenesisHash().send();
  if (actualHash !== expectedHash) {
    throw new Error(
      `RPC endpoint does not belong to the configured ${expectedCluster} cluster.`,
    );
  }
}

export class MultiRpcChainGateway implements ChainGateway {
  private source: string | null = null;

  constructor(
    private readonly rpcUrls: string[],
    private readonly expectedUsdcMint?: string,
    private readonly expectedCluster?: string,
  ) {
    if (rpcUrls.length === 0) {
      throw new Error("At least one Solana RPC URL is required.");
    }
  }

  lastSource(): string | null {
    return this.source;
  }

  async load(): Promise<V2Snapshot> {
    const failures: string[] = [];
    for (const rpcUrl of this.rpcUrls) {
      try {
        const rpc = makeV2Rpc(rpcUrl);
        await assertExpectedCluster(rpc, rpcUrl, this.expectedCluster);
        const snapshot = await loadV2Snapshot(
          rpc,
          this.expectedUsdcMint
            ? address(this.expectedUsdcMint)
            : undefined,
        );
        this.source = rpcUrl;
        return snapshot;
      } catch (error) {
        failures.push(
          `${rpcHost(rpcUrl)}: ${
            error instanceof Error ? error.message : "unknown failure"
          }`,
        );
      }
    }
    throw new ChainUnavailableError(
      `All configured Solana RPCs failed (${failures.join("; ")}).`,
    );
  }
}

export class FixedChainGateway implements ChainGateway {
  constructor(
    private readonly snapshot: V2Snapshot,
    private readonly source = "fixture",
  ) {}

  async load(): Promise<V2Snapshot> {
    return this.snapshot;
  }

  lastSource(): string | null {
    return this.source;
  }
}

export async function resolveRoles(
  wallet: string,
  snapshot: V2Snapshot,
  keeperAllowlist: readonly string[],
): Promise<Roles> {
  const walletAddress = address(wallet);
  const [expectedPassport, expectedMerchant] = await Promise.all([
    findPassportPda({ owner: walletAddress as Address }),
    findMerchantPda({ merchantSigner: walletAddress as Address }),
  ]);

  return {
    guest: snapshot.passports.some(
      (row) =>
        row.address === expectedPassport[0] &&
        row.data.owner === wallet,
    ),
    merchant: snapshot.merchants.some(
      (row) =>
        row.address === expectedMerchant[0] &&
        row.data.authority === wallet &&
        row.data.active,
    ),
    operator: snapshot.platform?.data.operator === wallet,
    keeper: keeperAllowlist.includes(wallet),
  };
}

export function hasAnyRole(roles: Roles): boolean {
  return roles.guest || roles.merchant || roles.operator || roles.keeper;
}
