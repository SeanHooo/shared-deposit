import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { ConflictError } from "./errors.js";
import {
  newRunId,
  type EventBatchInput,
  type IndexerRuntimeState,
  type ReconciliationInput,
  type ReconciliationResult,
} from "./indexer-types.js";
import {
  assertReconciliationInput,
  assertValidEventBatch,
} from "./store.js";
import type {
  AuditRecord,
  AuthChallenge,
  AuthStore,
  EvidenceRecord,
  IndexerStore,
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

type IndexerStateRow = {
  cluster: string;
  program_id: string;
  last_event_signature: string | null;
  last_event_slot: string | number | null;
  last_event_scan_slot: string | number | null;
  last_observed_slot: string | number | null;
  last_attempt_at: Date | null;
  last_success_at: Date | null;
  last_reconciliation_at: Date | null;
  last_error: string | null;
  updated_at: Date;
};

type ProjectionRow = {
  address: string;
  account_kind: string;
  data_hash: string;
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

function toIndexerState(row: IndexerStateRow): IndexerRuntimeState {
  return {
    cluster: row.cluster,
    programId: row.program_id,
    lastEventSignature: row.last_event_signature,
    lastEventSlot: bigintString(row.last_event_slot),
    lastEventScanSlot: bigintString(row.last_event_scan_slot),
    lastObservedSlot: bigintString(row.last_observed_slot),
    lastAttemptAt: row.last_attempt_at?.toISOString() ?? null,
    lastSuccessAt: row.last_success_at?.toISOString() ?? null,
    lastReconciliationAt:
      row.last_reconciliation_at?.toISOString() ?? null,
    lastError: row.last_error,
    updatedAt: row.updated_at.toISOString(),
  };
}

function bigintString(value: string | number | null): string | null {
  return value === null ? null : value.toString();
}

export class PostgresStore implements MetadataStore, AuthStore, IndexerStore {
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
    migrationName = "002_chain_indexer.sql",
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

  async indexerState(
    cluster: string,
    programId: string,
  ): Promise<IndexerRuntimeState | null> {
    const result = await this.pool.query<IndexerStateRow>(
      `SELECT
         cluster, program_id, last_event_signature, last_event_slot,
         last_event_scan_slot, last_observed_slot, last_attempt_at,
         last_success_at, last_reconciliation_at, last_error, updated_at
       FROM chain_indexer_state
       WHERE cluster = $1 AND program_id = $2`,
      [cluster, programId],
    );
    return result.rows[0] ? toIndexerState(result.rows[0]) : null;
  }

  async recordIndexerAttempt(input: {
    cluster: string;
    programId: string;
    at: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO chain_indexer_state (
         cluster, program_id, last_attempt_at, updated_at
       ) VALUES ($1, $2, $3, $3)
       ON CONFLICT (cluster, program_id) DO UPDATE SET
         last_attempt_at = EXCLUDED.last_attempt_at,
         updated_at = EXCLUDED.updated_at`,
      [input.cluster, input.programId, input.at],
    );
  }

  async applyEventBatch(
    input: EventBatchInput,
  ): Promise<{ inserted: number }> {
    assertValidEventBatch(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO chain_indexer_state (
           cluster, program_id, updated_at
         ) VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (cluster, program_id) DO NOTHING`,
        [input.cluster, input.programId],
      );
      const cursor = await client.query<{
        last_event_signature: string | null;
      }>(
        `SELECT last_event_signature
         FROM chain_indexer_state
         WHERE cluster = $1 AND program_id = $2
         FOR UPDATE`,
        [input.cluster, input.programId],
      );
      const current = cursor.rows[0]?.last_event_signature ?? null;
      if (current === input.signature) {
        await client.query("COMMIT");
        return { inserted: 0 };
      }
      if (current !== input.expectedPreviousSignature) {
        throw new Error(
          `Indexer cursor changed before transaction ${input.signature}.`,
        );
      }

      let inserted = 0;
      for (const event of input.events) {
        const result = await client.query(
          `INSERT INTO chain_events (
             cluster, program_id, signature, log_index, action, action_name,
             subject, owner, actor, amount, digest, event_timestamp, slot,
             block_time
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
           )
           ON CONFLICT (cluster, program_id, signature, log_index)
           DO NOTHING
           RETURNING 1`,
          [
            event.cluster,
            event.programId,
            event.signature,
            event.logIndex,
            event.action,
            event.actionName,
            event.subject,
            event.owner,
            event.actor,
            event.amount,
            event.digest,
            event.timestamp,
            event.slot,
            event.blockTime,
          ],
        );
        inserted += result.rowCount ?? 0;
      }
      await client.query(
        `UPDATE chain_indexer_state SET
           last_event_signature = $3,
           last_event_slot = $4,
           last_observed_slot = GREATEST(
             COALESCE(last_observed_slot, $4::BIGINT),
             $4::BIGINT
           ),
           updated_at = CURRENT_TIMESTAMP
         WHERE cluster = $1 AND program_id = $2`,
        [input.cluster, input.programId, input.signature, input.slot],
      );
      await client.query("COMMIT");
      return { inserted };
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async reconcileSnapshot(
    input: ReconciliationInput,
  ): Promise<ReconciliationResult> {
    assertReconciliationInput(input);
    const client = await this.pool.connect();
    const runId = newRunId();
    const startedAt = new Date();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      await client.query(
        `INSERT INTO chain_indexer_state (
           cluster, program_id, updated_at
         ) VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (cluster, program_id) DO NOTHING`,
        [input.cluster, input.programId],
      );
      await client.query(
        `SELECT 1
         FROM chain_indexer_state
         WHERE cluster = $1 AND program_id = $2
         FOR UPDATE`,
        [input.cluster, input.programId],
      );
      await client.query(
        `INSERT INTO chain_reconciliation_runs (
           id, cluster, program_id, status, snapshot_slot, started_at
         ) VALUES ($1, $2, $3, 'running', $4, $5)`,
        [runId, input.cluster, input.programId, input.snapshotSlot, startedAt],
      );

      const existingResult = await client.query<ProjectionRow>(
        `SELECT address, account_kind, data_hash
         FROM chain_account_projection
         WHERE cluster = $1 AND program_id = $2`,
        [input.cluster, input.programId],
      );
      const existing = new Map(
        existingResult.rows.map((row) => [row.address, row]),
      );
      const desired = new Map(
        input.accounts.map((account) => [account.address, account]),
      );
      if (desired.size !== input.accounts.length) {
        throw new Error("The snapshot contains duplicate account addresses.");
      }

      let inserted = 0;
      let updated = 0;
      let deleted = 0;
      let unchanged = 0;
      for (const account of input.accounts) {
        const previous = existing.get(account.address);
        let finding: "ADDED" | "UPDATED";
        if (!previous) {
          inserted += 1;
          finding = "ADDED";
        } else if (
          previous.data_hash !== account.dataHash ||
          previous.account_kind !== account.kind
        ) {
          updated += 1;
          finding = "UPDATED";
        } else {
          unchanged += 1;
          await client.query(
            `UPDATE chain_account_projection
             SET observed_slot = $4, updated_at = CURRENT_TIMESTAMP
             WHERE cluster = $1 AND program_id = $2 AND address = $3`,
            [
              input.cluster,
              input.programId,
              account.address,
              input.snapshotSlot,
            ],
          );
          continue;
        }

        await client.query(
          `INSERT INTO chain_account_projection (
             cluster, program_id, address, account_kind, data_json,
             data_hash, observed_slot, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
           ON CONFLICT (cluster, program_id, address) DO UPDATE SET
             account_kind = EXCLUDED.account_kind,
             data_json = EXCLUDED.data_json,
             data_hash = EXCLUDED.data_hash,
             observed_slot = EXCLUDED.observed_slot,
             updated_at = CURRENT_TIMESTAMP`,
          [
            input.cluster,
            input.programId,
            account.address,
            account.kind,
            account.dataJson,
            account.dataHash,
            input.snapshotSlot,
          ],
        );
        await client.query(
          `INSERT INTO chain_reconciliation_findings (
             id, run_id, address, account_kind, finding,
             old_data_hash, new_data_hash
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            randomUUID(),
            runId,
            account.address,
            account.kind,
            finding,
            previous?.data_hash ?? null,
            account.dataHash,
          ],
        );
      }

      for (const [address, previous] of existing) {
        if (desired.has(address)) continue;
        deleted += 1;
        await client.query(
          `DELETE FROM chain_account_projection
           WHERE cluster = $1 AND program_id = $2 AND address = $3`,
          [input.cluster, input.programId, address],
        );
        await client.query(
          `INSERT INTO chain_reconciliation_findings (
             id, run_id, address, account_kind, finding,
             old_data_hash, new_data_hash
           ) VALUES ($1, $2, $3, $4, 'REMOVED', $5, NULL)`,
          [
            randomUUID(),
            runId,
            address,
            previous.account_kind,
            previous.data_hash,
          ],
        );
      }

      const completedAt = new Date();
      await client.query(
        `UPDATE chain_reconciliation_runs SET
           status = 'completed',
           inserted_count = $2,
           updated_count = $3,
           deleted_count = $4,
           unchanged_count = $5,
           completed_at = $6
         WHERE id = $1`,
        [
          runId,
          inserted,
          updated,
          deleted,
          unchanged,
          completedAt,
        ],
      );
      await client.query(
        `UPDATE chain_indexer_state SET
           last_observed_slot = GREATEST(
             COALESCE(last_observed_slot, $3::BIGINT),
             $3::BIGINT
           ),
           last_reconciliation_at = $4,
           updated_at = $4
         WHERE cluster = $1 AND program_id = $2`,
        [
          input.cluster,
          input.programId,
          input.snapshotSlot,
          completedAt,
        ],
      );
      await client.query("COMMIT");
      transactionOpen = false;
      return {
        runId,
        snapshotSlot: input.snapshotSlot,
        inserted,
        updated,
        deleted,
        unchanged,
      };
    } catch (error) {
      if (transactionOpen) await rollback(client);
      const message =
        error instanceof Error ? error.message : "Reconciliation failed.";
      await this.pool
        .query(
          `INSERT INTO chain_reconciliation_runs (
             id, cluster, program_id, status, snapshot_slot,
             started_at, completed_at, error
           ) VALUES ($1, $2, $3, 'failed', $4, $5, CURRENT_TIMESTAMP, $6)`,
          [
            runId,
            input.cluster,
            input.programId,
            input.snapshotSlot,
            startedAt,
            message,
          ],
        )
        .catch(() => {
          // Preserve the reconciliation error.
        });
      throw error;
    } finally {
      client.release();
    }
  }

  async recordIndexerSuccess(input: {
    cluster: string;
    programId: string;
    observedSlot: string;
    eventScanSlot: string;
    at: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO chain_indexer_state (
         cluster, program_id, last_event_scan_slot, last_observed_slot,
         last_success_at, last_error, updated_at
       ) VALUES ($1, $2, $3, $4, $5, NULL, $5)
       ON CONFLICT (cluster, program_id) DO UPDATE SET
         last_event_scan_slot = GREATEST(
           COALESCE(chain_indexer_state.last_event_scan_slot, $4::BIGINT),
           $4::BIGINT
         ),
         last_observed_slot = GREATEST(
           COALESCE(chain_indexer_state.last_observed_slot, $3::BIGINT),
           $3::BIGINT
         ),
         last_success_at = EXCLUDED.last_success_at,
         last_error = NULL,
         updated_at = EXCLUDED.updated_at`,
      [
        input.cluster,
        input.programId,
        input.observedSlot,
        input.eventScanSlot,
        input.at,
      ],
    );
  }

  async recordIndexerFailure(input: {
    cluster: string;
    programId: string;
    error: string;
    observedSlot: string | null;
    at: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO chain_indexer_state (
         cluster, program_id, last_observed_slot,
         last_error, updated_at
       ) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (cluster, program_id) DO UPDATE SET
         last_observed_slot = CASE
           WHEN $3::BIGINT IS NULL THEN chain_indexer_state.last_observed_slot
           ELSE GREATEST(
             COALESCE(chain_indexer_state.last_observed_slot, $3::BIGINT),
             $3::BIGINT
           )
         END,
         last_error = EXCLUDED.last_error,
         updated_at = EXCLUDED.updated_at`,
      [
        input.cluster,
        input.programId,
        input.observedSlot,
        input.error,
        input.at,
      ],
    );
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
