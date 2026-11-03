import { getBase64Encoder, type ReadonlyUint8Array } from "@solana/kit";
import {
  PASSPORT_EVENT_EVENT_DISCRIMINATOR,
  parsePassportEventEvent,
} from "../../app/src/generated-v2/events/passportEvent.js";
import { PROGRAM_ADDRESS_V2 } from "../../app/src/program-v2.js";
import type {
  IndexerChainGateway,
  IndexerSignatureEntry,
} from "./chain.js";
import type {
  IndexedChainEvent,
  ReconciliationResult,
} from "./indexer-types.js";
import {
  projectSnapshotAccounts,
  type EventBatchInput,
} from "./indexer-types.js";
import type { IndexerStore } from "./store.js";

export const PASS_EVENT_ACTION_NAMES = [
  "PlatformInitialized",
  "PassportInitialized",
  "DepositInitialized",
  "Deposited",
  "Withdrawn",
  "MerchantRegistered",
  "MerchantStatusChanged",
  "RentalAuthorized",
  "AuthorizationRevoked",
  "RentalLocked",
  "RentalReturned",
  "DisputeOpened",
  "DisputeResolved",
  "TimedOut",
] as const;

export type IndexerOptions = {
  chain: IndexerChainGateway;
  store: IndexerStore;
  cluster: string;
  programId?: string;
  pageSize?: number;
  maxTransactionsPerCycle?: number;
  now?: () => number;
};

export type IndexerCycleResult = {
  reconciliation: ReconciliationResult;
  transactionsProcessed: number;
  eventsInserted: number;
  observedSlot: string;
  cursor: string | null;
};

export type ParsedChainEventInput = {
  cluster: string;
  programId: string;
  signature: string;
  slot: string;
  blockTime: string | null;
  logs: readonly string[];
};

export class ChainIndexer {
  private readonly chain: IndexerChainGateway;
  private readonly store: IndexerStore;
  private readonly cluster: string;
  private readonly programId: string;
  private readonly pageSize: number;
  private readonly maxTransactionsPerCycle: number;
  private readonly now: () => number;

  constructor(options: IndexerOptions) {
    this.chain = options.chain;
    this.store = options.store;
    this.cluster = options.cluster;
    this.programId = options.programId ?? PROGRAM_ADDRESS_V2;
    this.pageSize = options.pageSize ?? 100;
    this.maxTransactionsPerCycle = options.maxTransactionsPerCycle ?? 500;
    this.now = options.now ?? Date.now;
    if (this.pageSize < 1 || this.pageSize > 1_000) {
      throw new Error("Indexer page size must be between 1 and 1000.");
    }
    if (this.maxTransactionsPerCycle < 1) {
      throw new Error("Indexer transaction batch limit must be positive.");
    }
  }

  async runCycle(): Promise<IndexerCycleResult> {
    const attemptedAt = new Date(this.now()).toISOString();
    let observedSlot: string | null = null;
    await this.store.recordIndexerAttempt({
      cluster: this.cluster,
      programId: this.programId,
      at: attemptedAt,
    });

    try {
      const snapshot = await this.chain.load();
      const snapshotSlot = snapshot.slot.toString();
      if (!snapshot.deployed) {
        throw new Error(
          "The configured v2 program is not deployed on this RPC.",
        );
      }
      if (!snapshot.platform) {
        throw new Error(
          "The v2 platform account is missing from the RPC snapshot.",
        );
      }
      observedSlot = snapshotSlot;
      const reconciliation = await this.store.reconcileSnapshot({
        cluster: this.cluster,
        programId: this.programId,
        snapshotSlot: observedSlot,
        accounts: projectSnapshotAccounts(snapshot),
      });
      const stateBeforeEvents = await this.store.indexerState(
        this.cluster,
        this.programId,
      );
      const eventResult = await this.syncEvents(
        stateBeforeEvents?.lastEventSignature ?? null,
      );
      const eventScanSlot = eventResult.caughtUp
        ? observedSlot
        : eventResult.lastProcessedSlot;
      if (eventScanSlot === null) {
        throw new Error("The event batch did not produce a scan checkpoint.");
      }
      const completedAt = new Date(this.now()).toISOString();
      await this.store.recordIndexerSuccess({
        cluster: this.cluster,
        programId: this.programId,
        observedSlot,
        eventScanSlot,
        at: completedAt,
      });
      return {
        reconciliation,
        transactionsProcessed: eventResult.transactionsProcessed,
        eventsInserted: eventResult.eventsInserted,
        observedSlot,
        cursor: eventResult.cursor,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Indexer cycle failed.";
      try {
        await this.store.recordIndexerFailure({
          cluster: this.cluster,
          programId: this.programId,
          error: message,
          observedSlot,
          at: new Date(this.now()).toISOString(),
        });
      } catch (healthError) {
        throw new AggregateError(
          [error, healthError],
          "Indexer failed and its failure state could not be persisted.",
        );
      }
      throw error;
    }
  }

  private async syncEvents(cursor: string | null): Promise<{
    transactionsProcessed: number;
    eventsInserted: number;
    cursor: string | null;
    caughtUp: boolean;
    lastProcessedSlot: string | null;
  }> {
    const signatures = await this.transactionsAfterCursor(cursor);
    const transactions = signatures.slice(0, this.maxTransactionsPerCycle);
    let expectedPreviousSignature = cursor;
    let eventsInserted = 0;
    let lastProcessedSlot: string | null = null;

    for (const entry of transactions) {
      const transaction = await this.chain.transaction(entry.signature);
      if (transaction.slot !== entry.slot) {
        throw new Error(
          `Transaction ${entry.signature} changed slot between RPC reads.`,
        );
      }
      const events = transaction.failed
        ? []
        : parseChainEvents({
            cluster: this.cluster,
            programId: this.programId,
            signature: entry.signature,
            slot: transaction.slot,
            blockTime: transaction.blockTime,
            logs: transaction.logs,
          });
      const batch: EventBatchInput = {
        cluster: this.cluster,
        programId: this.programId,
        expectedPreviousSignature,
        signature: entry.signature,
        slot: transaction.slot,
        blockTime: transaction.blockTime,
        events,
      };
      const applied = await this.store.applyEventBatch(batch);
      eventsInserted += applied.inserted;
      expectedPreviousSignature = entry.signature;
      lastProcessedSlot = transaction.slot;
    }

    return {
      transactionsProcessed: transactions.length,
      eventsInserted,
      cursor: expectedPreviousSignature,
      caughtUp: transactions.length === signatures.length,
      lastProcessedSlot,
    };
  }

  private async transactionsAfterCursor(
    cursor: string | null,
  ): Promise<IndexerSignatureEntry[]> {
    const collected: IndexerSignatureEntry[] = [];
    const seen = new Set<string>();
    let before: string | null = null;
    let foundCursor = false;

    for (let pageNumber = 0; pageNumber < 10_000; pageNumber += 1) {
      const page = await this.chain.signaturesForAddress({
        address: this.programId,
        before,
        limit: this.pageSize,
      });
      if (page.length === 0) break;
      for (const entry of page) {
        if (seen.has(entry.signature)) continue;
        seen.add(entry.signature);
        collected.push(entry);
        if (entry.signature === cursor) foundCursor = true;
      }
      if (foundCursor) break;
      if (page.length < this.pageSize) break;

      const nextBefore = page.at(-1)?.signature ?? null;
      if (nextBefore === null || nextBefore === before) {
        throw new Error("RPC signature pagination did not advance.");
      }
      before = nextBefore;
    }

    if (cursor !== null && !foundCursor) {
      throw new Error(
        "The stored event cursor is outside the RPC's retained history.",
      );
    }

    const cursorIndex =
      cursor === null
        ? -1
        : collected.findIndex((entry) => entry.signature === cursor);
    const newer = cursorIndex === -1 ? collected : collected.slice(0, cursorIndex);
    return newer.reverse();
  }
}

export function parseChainEvents(
  input: ParsedChainEventInput,
): IndexedChainEvent[] {
  const stack: string[] = [];
  const events: IndexedChainEvent[] = [];

  for (const [logIndex, line] of input.logs.entries()) {
    const invoke = /^Program (\S+) invoke \[\d+\]$/.exec(line);
    if (invoke) {
      stack.push(invoke[1]);
      continue;
    }
    const exit = /^Program (\S+) (?:success|failed)\b/.exec(line);
    if (exit) {
      if (stack.at(-1) !== exit[1]) {
        throw new Error("The v2 transaction log stack is malformed.");
      }
      stack.pop();
      continue;
    }
    if (
      stack.at(-1) !== input.programId ||
      !line.startsWith("Program data: ")
    ) {
      continue;
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(
        getBase64Encoder().encode(line.slice("Program data: ".length)),
      );
    } catch {
      throw new Error("The v2 program emitted malformed base64 event data.");
    }
    if (
      bytes.length < PASSPORT_EVENT_EVENT_DISCRIMINATOR.length ||
      !PASSPORT_EVENT_EVENT_DISCRIMINATOR.every(
        (value, index) => bytes[index] === value,
      )
    ) {
      throw new Error("The v2 program emitted an unknown event discriminator.");
    }

    const event = parsePassportEventEvent(bytes);
    const actionName = PASS_EVENT_ACTION_NAMES[event.action];
    if (!actionName) {
      throw new Error(`The v2 program emitted unknown action ${event.action}.`);
    }
    events.push({
      cluster: input.cluster,
      programId: input.programId,
      signature: input.signature,
      logIndex,
      action: event.action,
      actionName,
      subject: event.subject,
      owner: event.owner,
      actor: event.actor,
      amount: event.amount.toString(),
      digest: hex(event.digest),
      timestamp: event.timestamp.toString(),
      slot: input.slot,
      blockTime: input.blockTime,
    });
  }
  return events;
}

function hex(bytes: Uint8Array | ReadonlyUint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
