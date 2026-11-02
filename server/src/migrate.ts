import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const migrationsDirectory = fileURLToPath(
  new URL("../migrations/", import.meta.url),
);

async function migrate(connectionString: string): Promise<void> {
  const pool = new Pool({
    connectionString,
    application_name: "shared-deposit-migrate",
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('shared_deposit_migrations'))",
    );
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
       )`,
    );

    const files = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const applied = await client.query(
        "SELECT 1 FROM schema_migrations WHERE name = $1",
        [file],
      );
      if (applied.rowCount) continue;
      const sql = await readFile(
        new URL(`../migrations/${file}`, import.meta.url),
        "utf8",
      );
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (name) VALUES ($1)",
        [file],
      );
      console.log(`Applied ${file}`);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required.");
  process.exitCode = 1;
} else {
  migrate(connectionString).catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Database migration failed.",
    );
    process.exitCode = 1;
  });
}
