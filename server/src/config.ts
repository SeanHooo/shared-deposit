import { z } from "zod/v4";

const walletAllowlist = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );

const rpcUrls = z
  .string()
  .default("https://api.devnet.solana.com")
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.url()).min(1));

const databaseUrl = z.url().refine(
  (value) => {
    const protocol = new URL(value).protocol;
    return protocol === "postgres:" || protocol === "postgresql:";
  },
  "DATABASE_URL must use postgres:// or postgresql://.",
);

const configSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  SOLANA_CLUSTER: z
    .enum(["localnet", "devnet", "mainnet-beta"])
    .default("devnet"),
  SOLANA_RPC_URLS: rpcUrls,
  USDC_MINT: z.string().min(32).max(44).optional(),
  SIWS_DOMAIN: z.string().min(1).default("localhost:5173"),
  SIWS_URI: z.url().default("http://localhost:5173"),
  JWT_SECRET: z
    .string()
    .min(32)
    .default("development-only-secret-change-before-deploy"),
  JWT_ISSUER: z.string().min(1).default("shared-deposit-api"),
  JWT_AUDIENCE: z.string().min(1).default("shared-deposit"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(3600)
    .default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(3600)
    .default(2_592_000),
  CHALLENGE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(30)
    .max(900)
    .default(300),
  KEEPER_ALLOWLIST: walletAllowlist,
  EVIDENCE_BUCKET: z.string().min(1).default("evidence"),
  DATABASE_URL: databaseUrl.optional(),
  DATABASE_POOL_SIZE: z.coerce
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10),
  INDEXER_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(500)
    .max(300_000)
    .default(5_000),
  INDEXER_STALE_AFTER_SECONDS: z.coerce
    .number()
    .int()
    .min(10)
    .max(86_400)
    .default(60),
  INDEXER_MAX_LAG_SLOTS: z.coerce
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER)
    .default(100),
  INDEXER_PAGE_SIZE: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000)
    .default(100),
  INDEXER_MAX_TRANSACTIONS_PER_CYCLE: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .default(500),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const config = configSchema.parse(environment);
  if (
    config.NODE_ENV === "production" &&
    config.JWT_SECRET === "development-only-secret-change-before-deploy"
  ) {
    throw new Error("JWT_SECRET must be set in production.");
  }
  if (config.NODE_ENV === "production" && !config.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set in production.");
  }
  return config;
}
