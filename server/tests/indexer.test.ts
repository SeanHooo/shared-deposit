import { address, getBase58Decoder } from "@solana/kit";
import { describe, expect, it } from "vitest";
import type { V2Snapshot } from "../../app/src/chain-v2.js";
import {
  PASSPORT_EVENT_EVENT_DISCRIMINATOR,
  getPassportEventEventEncoder,
} from "../../app/src/generated-v2/events/passportEvent.js";
import { PROGRAM_ADDRESS_V2 } from "../../app/src/program-v2.js";
import type {
  IndexerChainGateway,
  IndexerSignatureEntry,
  IndexerTransaction,
} from "../src/chain.js";
import { ChainIndexer, parseChainEvents } from "../src/indexer.js";
import {
  projectSnapshotAccounts,
  type EventBatchInput,
} from "../src/indexer-types.js";
import { InMemoryIndexerStore } from "../src/store.js";
import { snapshotFor, syntheticWallet } from "./fixtures.js";

const CLUSTER = "localnet";
const SIGNATURE = getBase58Decoder().decode(new Uint8Array(64).fill(7));
const SECOND_SIGNATURE = getBase58Decoder().decode(
  new Uint8Array(64).fill(8),
);

class FakeIndexerChain implements IndexerChainGateway {
  constructor(
    private readonly snapshot: V2Snapshot,
    private readonly signatures: IndexerSignatureEntry[],
    private readonly transactions: Map<string, IndexerTransaction>,
  ) {}

  async load(): Promise<V2Snapshot> {
    return this.snapshot;
  }

  lastSource(): string {
    return "fixture";
  }

  async signaturesForAddress(input: {
    before: string | null;
    limit: number;
  }): Promise<IndexerSignatureEntry[]> {
    const start =
      input.before === null
        ? 0
        : this.signatures.findIndex(
            (entry) => entry.signature === input.before,
          ) + 1;
    return this.signatures.slice(start, start + input.limit);
  }

  async transaction(signature: string): Promise<IndexerTransaction> {
    const transaction = this.transactions.get(signature);
    if (!transaction) throw new Error(`Missing fixture transaction ${signature}.`);
    return transaction;
  }
}

async function fixture() {
  const [guest, merchant, operator] = await Promise.all([
    syntheticWallet(),
    syntheticWallet(),
    syntheticWallet(),
  ]);
  const snapshot = await snapshotFor(
    guest.wallet,
    merchant.wallet,
    operator.wallet,
  );
  return { snapshot };
}

function eventLogs(action = 9): string[] {
  const bytes = getPassportEventEventEncoder().encode({
    action,
    subject: PROGRAM_ADDRESS_V2,
    owner: address("11111111111111111111111111111111"),
    actor: address("So11111111111111111111111111111111111111112"),
    amount: 10_000_000n,
    digest: new Uint8Array(32).fill(2),
    timestamp: 1_789_000_100n,
  });
  return [
    `Program ${PROGRAM_ADDRESS_V2} invoke [1]`,
    "Program log: fixture",
    `Program data: ${Buffer.from(bytes).toString("base64")}`,
    `Program ${PROGRAM_ADDRESS_V2} success`,
  ];
}

describe("chain event parsing and indexing", () => {
  it("decodes the generated v2 event while the program is at the log-stack top", async () => {
    const events = parseChainEvents({
      cluster: CLUSTER,
      programId: PROGRAM_ADDRESS_V2,
      signature: SIGNATURE,
      slot: "123",
      blockTime: "1789000100",
      logs: eventLogs(9),
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 9,
      actionName: "RentalLocked",
      amount: "10000000",
      timestamp: "1789000100",
      digest: "02".repeat(32),
      slot: "123",
      logIndex: 2,
    });
  });

  it("inserts an event batch once when the same transaction is replayed", async () => {
    const store = new InMemoryIndexerStore();
    const events = parseChainEvents({
      cluster: CLUSTER,
      programId: PROGRAM_ADDRESS_V2,
      signature: SIGNATURE,
      slot: "123",
      blockTime: null,
      logs: eventLogs(),
    });
    const batch: EventBatchInput = {
      cluster: CLUSTER,
      programId: PROGRAM_ADDRESS_V2,
      expectedPreviousSignature: null,
      signature: SIGNATURE,
      slot: "123",
      blockTime: null,
      events,
    };

    await expect(store.applyEventBatch(batch)).resolves.toEqual({
      inserted: 1,
    });
    await expect(store.applyEventBatch(batch)).resolves.toEqual({
      inserted: 0,
    });
    expect(store.events()).toHaveLength(1);
  });

  it("runs a full cycle and advances the cursor only after the transaction is stored", async () => {
    const { snapshot } = await fixture();
    const store = new InMemoryIndexerStore(() => 1_790_000_000_000);
    const chain = new FakeIndexerChain(
      snapshot,
      [
        {
          signature: SIGNATURE,
          slot: "123",
          blockTime: "1789000100",
          failed: false,
        },
      ],
      new Map([
        [
          SIGNATURE,
          {
            slot: "123",
            blockTime: "1789000100",
            logs: eventLogs(),
            failed: false,
          },
        ],
      ]),
    );
    const indexer = new ChainIndexer({
      chain,
      store,
      cluster: CLUSTER,
      now: () => 1_790_000_000_000,
    });

    const result = await indexer.runCycle();
    expect(result).toMatchObject({
      transactionsProcessed: 1,
      eventsInserted: 1,
      observedSlot: "123",
      cursor: SIGNATURE,
    });
    expect(await store.indexerState(CLUSTER, PROGRAM_ADDRESS_V2)).toMatchObject(
      {
        lastEventSignature: SIGNATURE,
        lastEventSlot: "123",
        lastObservedSlot: "123",
        lastError: null,
      },
    );
    expect(store.projection().length).toBeGreaterThan(0);
  });

  it("marks the event stream caught up when there are no new transactions", async () => {
    const { snapshot } = await fixture();
    const store = new InMemoryIndexerStore();
    const indexer = new ChainIndexer({
      chain: new FakeIndexerChain(snapshot, [], new Map()),
      store,
      cluster: CLUSTER,
    });

    await indexer.runCycle();

    expect(await store.indexerState(CLUSTER, PROGRAM_ADDRESS_V2)).toMatchObject(
      {
        lastEventSignature: null,
        lastEventSlot: null,
        lastEventScanSlot: "123",
        lastObservedSlot: "123",
        lastError: null,
      },
    );
  });

  it("keeps the event scan checkpoint behind when a cycle hits its batch limit", async () => {
    const { snapshot } = await fixture();
    const snapshotAt124 = { ...structuredClone(snapshot), slot: 124n };
    const store = new InMemoryIndexerStore();
    const chain = new FakeIndexerChain(
      snapshotAt124,
      [
        {
          signature: SECOND_SIGNATURE,
          slot: "124",
          blockTime: "1789000101",
          failed: false,
        },
        {
          signature: SIGNATURE,
          slot: "123",
          blockTime: "1789000100",
          failed: false,
        },
      ],
      new Map([
        [
          SIGNATURE,
          {
            slot: "123",
            blockTime: "1789000100",
            logs: eventLogs(),
            failed: false,
          },
        ],
        [
          SECOND_SIGNATURE,
          {
            slot: "124",
            blockTime: "1789000101",
            logs: eventLogs(),
            failed: false,
          },
        ],
      ]),
    );
    const indexer = new ChainIndexer({
      chain,
      store,
      cluster: CLUSTER,
      maxTransactionsPerCycle: 1,
    });

    await indexer.runCycle();
    expect(await store.indexerState(CLUSTER, PROGRAM_ADDRESS_V2)).toMatchObject(
      {
        lastEventSignature: SIGNATURE,
        lastEventSlot: "123",
        lastEventScanSlot: "123",
        lastObservedSlot: "124",
      },
    );

    await indexer.runCycle();
    expect(await store.indexerState(CLUSTER, PROGRAM_ADDRESS_V2)).toMatchObject(
      {
        lastEventSignature: SECOND_SIGNATURE,
        lastEventSlot: "124",
        lastEventScanSlot: "124",
        lastObservedSlot: "124",
      },
    );
  });

  it("does not advance the cursor when getTransaction fails", async () => {
    const { snapshot } = await fixture();
    const store = new InMemoryIndexerStore();
    const chain = new FakeIndexerChain(
      snapshot,
      [
        {
          signature: SIGNATURE,
          slot: "123",
          blockTime: null,
          failed: false,
        },
      ],
      new Map(),
    );
    const indexer = new ChainIndexer({ chain, store, cluster: CLUSTER });

    await expect(indexer.runCycle()).rejects.toThrow("Missing fixture");
    expect(await store.indexerState(CLUSTER, PROGRAM_ADDRESS_V2)).toMatchObject(
      {
        lastEventSignature: null,
        lastEventSlot: null,
        lastError: expect.stringContaining("Missing fixture"),
      },
    );
  });

  it("keeps the previous projection when the RPC snapshot is uninitialized", async () => {
    const { snapshot } = await fixture();
    const store = new InMemoryIndexerStore();
    await store.reconcileSnapshot({
      cluster: CLUSTER,
      programId: PROGRAM_ADDRESS_V2,
      snapshotSlot: "100",
      accounts: projectSnapshotAccounts(snapshot),
    });
    const projectionCount = store.projection().length;
    const chain = new FakeIndexerChain(
      {
        ...snapshot,
        platform: null,
        deployed: true,
      },
      [],
      new Map(),
    );
    const indexer = new ChainIndexer({ chain, store, cluster: CLUSTER });

    await expect(indexer.runCycle()).rejects.toThrow(
      "platform account is missing",
    );
    expect(store.projection()).toHaveLength(projectionCount);
    expect(await store.indexerState(CLUSTER, PROGRAM_ADDRESS_V2)).toMatchObject(
      {
        lastObservedSlot: "100",
        lastError: expect.stringContaining("platform account is missing"),
      },
    );
  });

  it("rejects malformed expected-program events without advancing the cursor", async () => {
    const { snapshot } = await fixture();
    const store = new InMemoryIndexerStore();
    const malformedLogs = [
      `Program ${PROGRAM_ADDRESS_V2} invoke [1]`,
      `Program data: ${Buffer.from(
        new Uint8Array([
          ...PASSPORT_EVENT_EVENT_DISCRIMINATOR.map((value) => value + 1),
        ]),
      ).toString("base64")}`,
      `Program ${PROGRAM_ADDRESS_V2} success`,
    ];
    const chain = new FakeIndexerChain(
      snapshot,
      [
        {
          signature: SIGNATURE,
          slot: "123",
          blockTime: null,
          failed: false,
        },
      ],
      new Map([
        [
          SIGNATURE,
          {
            slot: "123",
            blockTime: null,
            logs: malformedLogs,
            failed: false,
          },
        ],
      ]),
    );
    const indexer = new ChainIndexer({ chain, store, cluster: CLUSTER });

    await expect(indexer.runCycle()).rejects.toThrow(
      "unknown event discriminator",
    );
    expect((await store.indexerState(CLUSTER, PROGRAM_ADDRESS_V2))
      ?.lastEventSignature).toBeNull();
  });

  it("reconciles added, updated, removed, and unchanged account projections", async () => {
    const { snapshot } = await fixture();
    const second = structuredClone(snapshot);
    second.rentals[0].data.amount = 20_000_000n;
    second.merchants = [];
    const store = new InMemoryIndexerStore();

    const firstResult = await store.reconcileSnapshot({
      cluster: CLUSTER,
      programId: PROGRAM_ADDRESS_V2,
      snapshotSlot: "123",
      accounts: projectSnapshotAccounts(snapshot),
    });
    expect(firstResult).toMatchObject({
      inserted: 4,
      updated: 0,
      deleted: 0,
      unchanged: 0,
    });

    const secondResult = await store.reconcileSnapshot({
      cluster: CLUSTER,
      programId: PROGRAM_ADDRESS_V2,
      snapshotSlot: "124",
      accounts: projectSnapshotAccounts(second),
    });
    expect(secondResult).toMatchObject({
      inserted: 0,
      updated: 1,
      deleted: 1,
      unchanged: 2,
    });
    expect(
      store.reconciliationFindings().map((finding) => finding.finding).sort(),
    ).toEqual(["ADDED", "ADDED", "ADDED", "ADDED", "REMOVED", "UPDATED"]);

    const stableResult = await store.reconcileSnapshot({
      cluster: CLUSTER,
      programId: PROGRAM_ADDRESS_V2,
      snapshotSlot: "125",
      accounts: projectSnapshotAccounts(second),
    });
    expect(stableResult).toMatchObject({
      inserted: 0,
      updated: 0,
      deleted: 0,
      unchanged: 3,
    });
  });
});
