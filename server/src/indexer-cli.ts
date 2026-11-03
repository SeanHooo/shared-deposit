import { loadConfig } from "./config.js";
import { MultiRpcIndexerGateway } from "./chain.js";
import { ChainIndexer } from "./indexer.js";
import { PostgresStore } from "./postgres.js";

const config = loadConfig();
if (!config.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to run the chain indexer.");
}

const database = PostgresStore.connect(
  config.DATABASE_URL,
  config.DATABASE_POOL_SIZE,
);
await database.assertMigrated();

const indexer = new ChainIndexer({
  chain: new MultiRpcIndexerGateway(
    config.SOLANA_RPC_URLS,
    config.USDC_MINT,
    config.SOLANA_CLUSTER,
  ),
  store: database,
  cluster: config.SOLANA_CLUSTER,
  pageSize: config.INDEXER_PAGE_SIZE,
  maxTransactionsPerCycle: config.INDEXER_MAX_TRANSACTIONS_PER_CYCLE,
});

let stopping = false;
const stop = () => {
  stopping = true;
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

try {
  while (!stopping) {
    try {
      const result = await indexer.runCycle();
      console.log(
        JSON.stringify({
          event: "indexer.cycle",
          observedSlot: result.observedSlot,
          cursor: result.cursor,
          reconciliation: result.reconciliation,
          transactionsProcessed: result.transactionsProcessed,
          eventsInserted: result.eventsInserted,
        }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "indexer.failure",
          error: error instanceof Error ? error.message : "unknown failure",
        }),
      );
    }
    if (!stopping) await sleep(config.INDEXER_POLL_INTERVAL_MS);
  }
} finally {
  await database.close();
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
