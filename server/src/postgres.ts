import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { ConflictError } from "./errors.js";
import type {
  AuditRecord,
  AuthChallenge,
  AuthStore,
  EvidenceRecord,
  MetadataStore,
  NotificationRecord,
  RefreshRotationResult,
  RefreshTokenRecord,
} from "./store.js";

type EvidenceRow = {
  id: string;
  rental: string;
  evidence_digest: string;
  object_key: string;
  content_type: string;
  size_bytes: number;
  uploaded_by: string;
  created_at: Date;
};

type NotificationRow = {
  id: string;
  wallet: string;
  kind: NotificationRecord["kind"];
  title: string;
  body: string;
  rental: string | null;
  read_at: Date | null;
  created_at: Date;
};

type ChallengeRow = {
  id: string;
  wallet: string;
  nonce: string;
  message: string;
  expires_at: string;
};

type RefreshRow = {
  token_hash: string;
  wallet: string;
  family_id: string;
  expires_at: string;
  used_at: string | null;
};

function toEvidence(row: EvidenceRow): EvidenceRecord {
  return {
    id: row.id,
    rental: row.rental,
    evidenceDigest: row.evidence_digest,
    objectKey: row.object_key,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at.toISOString(),
  };
}

function toNotification(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    wallet: row.wallet,
    kind: row.kind,
    title: row.title,
    body: row.body,
    rental: row.rental,
    readAt: row.read_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

function toChallenge(row: ChallengeRow): AuthChallenge {
  return {
    id: row.id,
    wallet: row.wallet,
    nonce: row.nonce,
    message: row.message,
    expiresAt: Number(row.expires_at),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

export class PostgresStore implements MetadataStore, AuthStore {
  constructor(private readonly pool: Pool) {}

  static connect(connectionString: string, maxConnections = 10): PostgresStore {
    return new PostgresStore(
      new Pool({
        connectionString,
        max: maxConnections,
        application_name: "shared-deposit-api",
      }),
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async assertMigrated(
    migrationName = "001_runtime_persistence.sql",
  ): Promise<void> {
    const result = await this.pool.query<{ applied: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM schema_migrations WHERE name = $1
       ) AS applied`,
      [migrationName],
    );
    if (!result.rows[0]?.applied) {
      throw new Error(
        "Database migrations are not applied. Run npm run db:migrate.",
      );
    }
  }

  async addEvidence(
    evidence: Omit<EvidenceRecord, "id" | "createdAt">,
  ): Promise<EvidenceRecord> {
    try {
      const result = await this.pool.query<EvidenceRow>(
        `INSERT INTO evidence (
           id, rental, evidence_digest, object_key, content_type,
           size_bytes, uploaded_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING
           id, rental, evidence_digest, object_key, content_type,
           size_bytes, uploaded_by, created_at`,
        [
          randomUUID(),
          evidence.rental,
          evidence.evidenceDigest,
          evidence.objectKey,
          evidence.contentType,
          evidence.sizeBytes,
          evidence.uploadedBy,
        ],
      );
      return toEvidence(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(
          "This evidence digest is already registered.",
        );
      }
      throw error;
    }
  }

  async evidenceByRental(rental: string): Promise<EvidenceRecord[]> {
    const result = await this.pool.query<EvidenceRow>(
      `SELECT
         id, rental, evidence_digest, object_key, content_type,
         size_bytes, uploaded_by, created_at
       FROM evidence
       WHERE rental = $1
       ORDER BY created_at ASC, id ASC`,
      [rental],
    );
    return result.rows.map(toEvidence);
  }

  async evidenceByDigest(
    rental: string,
    digest: string,
  ): Promise<EvidenceRecord | null> {
    const result = await this.pool.query<EvidenceRow>(
      `SELECT
         id, rental, evidence_digest, object_key, content_type,
         size_bytes, uploaded_by, created_at
       FROM evidence
       WHERE rental = $1 AND evidence_digest = $2
       LIMIT 1`,
      [rental, digest],
    );
    return result.rows[0] ? toEvidence(result.rows[0]) : null;
  }

  async notifications(wallet: string): Promise<NotificationRecord[]> {
    const result = await this.pool.query<NotificationRow>(
      `SELECT
         id, wallet, kind, title, body, rental, read_at, created_at
       FROM notifications
       WHERE wallet = $1
       ORDER BY created_at DESC, id DESC`,
      [wallet],
    );
    return result.rows.map(toNotification);
  }

  async markNotificationRead(
    wallet: string,
    id: string,
  ): Promise<NotificationRecord | null> {
    const result = await this.pool.query<NotificationRow>(
      `UPDATE notifications
       SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
       WHERE wallet = $1 AND id = $2
       RETURNING
         id, wallet, kind, title, body, rental, read_at, created_at`,
      [wallet, id],
    );
    return result.rows[0] ? toNotification(result.rows[0]) : null;
  }

  async audit(
    record: Omit<AuditRecord, "id" | "createdAt">,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_logs (id, actor, action, subject)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), record.actor, record.action, record.subject],
    );
  }

  async saveChallenge(challenge: AuthChallenge): Promise<void> {
    await this.pool.query(
      `INSERT INTO siws_challenges (
         id, wallet, nonce, message, expires_at
       ) VALUES ($1, $2, $3, $4, $5)`,
      [
        challenge.id,
        challenge.wallet,
        challenge.nonce,
        challenge.message,
        challenge.expiresAt,
      ],
    );
  }

  async takeChallenge(id: string): Promise<AuthChallenge | null> {
    const result = await this.pool.query<ChallengeRow>(
      `DELETE FROM siws_challenges
       WHERE id = $1
       RETURNING id, wallet, nonce, message, expires_at`,
      [id],
    );
    return result.rows[0] ? toChallenge(result.rows[0]) : null;
  }

  async addRefreshToken(record: RefreshTokenRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO refresh_tokens (
         token_hash, wallet, family_id, expires_at, used_at
       ) VALUES ($1, $2, $3, $4, $5)`,
      [
        record.tokenHash,
        record.wallet,
        record.familyId,
        record.expiresAt,
        record.usedAt,
      ],
    );
  }

  async rotateRefresh(input: {
    currentTokenHash: string;
    nextTokenHash: string;
    nextExpiresAt: number;
    now: number;
  }): Promise<RefreshRotationResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const claimed = await client.query<RefreshRow>(
        `UPDATE refresh_tokens
         SET used_at = $2
         WHERE token_hash = $1
           AND used_at IS NULL
           AND expires_at > $2
         RETURNING
           token_hash, wallet, family_id, expires_at, used_at`,
        [input.currentTokenHash, input.now],
      );
      const current = claimed.rows[0];
      if (current) {
        await client.query(
          `INSERT INTO refresh_tokens (
             token_hash, wallet, family_id, expires_at, used_at
           ) VALUES ($1, $2, $3, $4, NULL)`,
          [
            input.nextTokenHash,
            current.wallet,
            current.family_id,
            input.nextExpiresAt,
          ],
        );
        await client.query("COMMIT");
        return {
          status: "ok",
          wallet: current.wallet,
          familyId: current.family_id,
        };
      }

      const existing = await client.query<RefreshRow>(
        `SELECT token_hash, wallet, family_id, expires_at, used_at
         FROM refresh_tokens
         WHERE token_hash = $1`,
        [input.currentTokenHash],
      );
      const record = existing.rows[0];
      if (!record) {
        await client.query("COMMIT");
        return { status: "unknown" };
      }
      await client.query(
        "DELETE FROM refresh_tokens WHERE family_id = $1",
        [record.family_id],
      );
      await client.query("COMMIT");
      return {
        status: record.used_at !== null ? "reused" : "expired",
      };
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeRefreshToken(tokenHash: string): Promise<void> {
    const result = await this.pool.query<Pick<RefreshRow, "family_id">>(
      `SELECT family_id FROM refresh_tokens WHERE token_hash = $1`,
      [tokenHash],
    );
    const familyId = result.rows[0]?.family_id;
    if (familyId) {
      await this.pool.query(
        "DELETE FROM refresh_tokens WHERE family_id = $1",
        [familyId],
      );
    }
  }
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original database error.
  }
}
