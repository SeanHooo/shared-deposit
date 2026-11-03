import { loadConfig } from "./config.js";
import { AuthService } from "./auth.js";
import { MultiRpcChainGateway } from "./chain.js";
import { PostgresStore } from "./postgres.js";
import {
  InMemoryAuthStore,
  InMemoryMetadataStore,
} from "./store.js";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const database = config.DATABASE_URL
    ? PostgresStore.connect(config.DATABASE_URL, config.DATABASE_POOL_SIZE)
    : null;

  try {
    await database?.assertMigrated();
    const chain = new MultiRpcChainGateway(
      config.SOLANA_RPC_URLS,
      config.USDC_MINT,
      config.SOLANA_CLUSTER,
    );
    const auth = new AuthService(
      {
        domain: config.SIWS_DOMAIN,
        uri: config.SIWS_URI,
        jwtSecret: config.JWT_SECRET,
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
        accessTokenTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
        refreshTokenTtlSeconds: config.REFRESH_TOKEN_TTL_SECONDS,
        challengeTtlSeconds: config.CHALLENGE_TTL_SECONDS,
      },
      Date.now,
      database ?? new InMemoryAuthStore(),
    );
    const store = database ?? new InMemoryMetadataStore();

    const app = await buildApp({
      config,
      chain,
      auth,
      store,
      indexerHealth: database
        ? () =>
            database.indexerState(
              config.SOLANA_CLUSTER,
              "5rnNqVQG4zy4JUYHWxCEaYsbBEpNu8fHLn9p2MsdrVfx",
            )
        : undefined,
      onClose: database ? () => database.close() : undefined,
    });
    await app.listen({ host: config.HOST, port: config.PORT });
  } catch (error) {
    await database?.close();
    throw error;
  }
}

await main();
