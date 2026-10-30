import { loadConfig } from "./config.js";
import { AuthService } from "./auth.js";
import { MultiRpcChainGateway } from "./chain.js";
import { InMemoryMetadataStore } from "./store.js";
import { buildApp } from "./app.js";

const config = loadConfig();
const chain = new MultiRpcChainGateway(
  config.SOLANA_RPC_URLS,
  config.USDC_MINT,
  config.SOLANA_CLUSTER,
);
const auth = new AuthService({
  domain: config.SIWS_DOMAIN,
  uri: config.SIWS_URI,
  jwtSecret: config.JWT_SECRET,
  issuer: config.JWT_ISSUER,
  audience: config.JWT_AUDIENCE,
  accessTokenTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
  refreshTokenTtlSeconds: config.REFRESH_TOKEN_TTL_SECONDS,
  challengeTtlSeconds: config.CHALLENGE_TTL_SECONDS,
});
const store = new InMemoryMetadataStore();

const app = await buildApp({ config, chain, auth, store });
await app.listen({ host: config.HOST, port: config.PORT });
