import { createHash, randomUUID } from "node:crypto";
import type { V2Snapshot } from "../../app/src/chain-v2.js";

export const INDEXER_ACCOUNT_KINDS = [
  "platform",
  "passport",
  "deposit",
  "merchant",
  "authorization",
  "rental",
] as const;

export type ChainAccountKind = (typeof INDEXER_ACCOUNT_KINDS)[number];

export type ChainAccountProjection = {
  address: string;
  kind: ChainAccountKind;
  dataJson: string;
  dataHash: string;
};

export type IndexedChainEvent = {
  cluster: string;
  programId: string;
  signature: string;
  logIndex: number;
  action: number;
  actionName: string;
  subject: string;
  owner: string;
  actor: string;
  amount: string;
  digest: string;
  timestamp: string;
  slot: string;
  blockTime: string | null;
};

export type EventBatchInput = {
  cluster: string;
  programId: string;
  expectedPreviousSignature: string | null;
  signature: string;
  slot: string;
  blockTime: string | null;
  events: IndexedChainEvent[];
};

export type ReconciliationResult = {
  runId: string;
  snapshotSlot: string;
  inserted: number;
  updated: number;
  deleted: number;
  unchanged: number;
};

export type ReconciliationInput = {
  cluster: string;
  programId: string;
  snapshotSlot: string;
  accounts: ChainAccountProjection[];
};

export type IndexerRuntimeState = {
  cluster: string;
  programId: string;
  lastEventSignature: string | null;
  lastEventSlot: string | null;
  lastEventScanSlot: string | null;
  lastObservedSlot: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastReconciliationAt: string | null;
  lastError: string | null;
  updatedAt: string | null;
};

export type IndexerHealth = IndexerRuntimeState & {
  status: "starting" | "healthy" | "degraded";
  eventLagSlots: string | null;
  staleAfterSeconds: number;
  maxLagSlots: string;
};

export type IndexerHealthThresholds = {
  staleAfterSeconds: number;
  maxLagSlots: bigint;
};

function canonicalize(value: unknown): unknown {
  if (typeof value === "bigint") {
    return { $bigint: value.toString() };
  }
  if (value instanceof Uint8Array) {
    return {
      $bytes: [...value]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(""),
    };
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hashAccountProjection(
  address: string,
  kind: ChainAccountKind,
  dataJson: string,
): string {
  return createHash("sha256")
    .update(`${kind}\0${address}\0${dataJson}`)
    .digest("hex");
}

export function projectSnapshotAccounts(
  snapshot: V2Snapshot,
): ChainAccountProjection[] {
  const entries: Array<{
    kind: ChainAccountKind;
    rows: ReadonlyArray<{ address: string; data: unknown }>;
  }> = [
    { kind: "platform", rows: snapshot.platform ? [snapshot.platform] : [] },
    { kind: "passport", rows: snapshot.passports },
    { kind: "deposit", rows: snapshot.deposits },
    { kind: "merchant", rows: snapshot.merchants },
    { kind: "authorization", rows: snapshot.authorizations },
    { kind: "rental", rows: snapshot.rentals },
  ];
  const seen = new Set<string>();
  const projections: ChainAccountProjection[] = [];

  for (const entry of entries) {
    for (const row of entry.rows) {
      if (seen.has(row.address)) {
        throw new Error(
          `The v2 snapshot contains duplicate account ${row.address}.`,
        );
      }
      seen.add(row.address);
      const dataJson = canonicalJson(row.data);
      projections.push({
        address: row.address,
        kind: entry.kind,
        dataJson,
        dataHash: hashAccountProjection(row.address, entry.kind, dataJson),
      });
    }
  }
  return projections;
}

export function deriveIndexerHealth(
  state: IndexerRuntimeState | null,
  now: number,
  thresholds: IndexerHealthThresholds,
): IndexerHealth | null {
  if (!state) return null;
  const observed =
    state.lastObservedSlot === null ? null : BigInt(state.lastObservedSlot);
  const eventScan =
    state.lastEventScanSlot === null
      ? null
      : BigInt(state.lastEventScanSlot);
  const lag =
    observed === null || eventScan === null
      ? null
      : observed > eventScan
        ? observed - eventScan
        : 0n;
  const healthTimestamp = state.lastSuccessAt ?? state.lastAttemptAt;
  const stale =
    healthTimestamp !== null &&
    now - Date.parse(healthTimestamp) >
      thresholds.staleAfterSeconds * 1_000;
  const lagged = lag !== null && lag > thresholds.maxLagSlots;
  const degraded = state.lastError !== null || stale || lagged;
  const starting = state.lastSuccessAt === null;

  return {
    ...state,
    status: degraded ? "degraded" : starting ? "starting" : "healthy",
    eventLagSlots: lag?.toString() ?? null,
    staleAfterSeconds: thresholds.staleAfterSeconds,
    maxLagSlots: thresholds.maxLagSlots.toString(),
  };
}

export function newRunId(): string {
  return randomUUID();
}
