import { randomUUID } from "node:crypto";
import { ConflictError } from "./errors.js";
import {
  newRunId,
  type ChainAccountKind,
  type ChainAccountProjection,
  type EventBatchInput,
  type IndexedChainEvent,
  type IndexerRuntimeState,
  type ReconciliationInput,
  type ReconciliationResult,
} from "./indexer-types.js";

export type EvidenceRecord = {
  id: string;
  rental: string;
  evidenceDigest: string;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
};

export type NotificationRecord = {
  id: string;
  wallet: string;
  kind: "rental" | "dispute" | "evidence" | "system";
  title: string;
  body: string;
  rental: string | null;
  readAt: string | null;
  createdAt: string;
};

export type AuditRecord = {
  id: string;
  actor: string;
  action: string;
  subject: string;
  createdAt: string;
};

export type AuthChallenge = {
  id: string;
  wallet: string;
  nonce: string;
  message: string;
  expiresAt: number;
};

export type RefreshTokenRecord = {
  tokenHash: string;
  wallet: string;
  familyId: string;
  expiresAt: number;
  usedAt: number | null;
};

export type RefreshRotationResult =
  | {
      status: "ok";
      wallet: string;
      familyId: string;
    }
  | {
      status: "expired" | "reused" | "unknown";
    };

export interface MetadataStore {
  addEvidence(
    evidence: Omit<EvidenceRecord, "id" | "createdAt">,
  ): Promise<EvidenceRecord>;
  evidenceByRental(rental: string): Promise<EvidenceRecord[]>;
  evidenceByDigest(
    rental: string,
    digest: string,
  ): Promise<EvidenceRecord | null>;
  notifications(wallet: string): Promise<NotificationRecord[]>;
  markNotificationRead(
    wallet: string,
    id: string,
  ): Promise<NotificationRecord | null>;
  audit(record: Omit<AuditRecord, "id" | "createdAt">): Promise<void>;
}

export interface AuthStore {
  saveChallenge(challenge: AuthChallenge): Promise<void>;
  takeChallenge(id: string): Promise<AuthChallenge | null>;
  addRefreshToken(record: RefreshTokenRecord): Promise<void>;
  rotateRefresh(input: {
    currentTokenHash: string;
    nextTokenHash: string;
    nextExpiresAt: number;
    now: number;
  }): Promise<RefreshRotationResult>;
  revokeRefreshToken(tokenHash: string): Promise<void>;
}

export interface IndexerStore {
  indexerState(
    cluster: string,
    programId: string,
  ): Promise<IndexerRuntimeState | null>;
  recordIndexerAttempt(input: {
    cluster: string;
    programId: string;
    at: string;
  }): Promise<void>;
  applyEventBatch(input: EventBatchInput): Promise<{ inserted: number }>;
  reconcileSnapshot(input: ReconciliationInput): Promise<ReconciliationResult>;
  recordIndexerSuccess(input: {
    cluster: string;
    programId: string;
    observedSlot: string;
    eventScanSlot: string;
    at: string;
  }): Promise<void>;
  recordIndexerFailure(input: {
    cluster: string;
    programId: string;
    error: string;
    observedSlot: string | null;
    at: string;
  }): Promise<void>;
}

export class InMemoryMetadataStore implements MetadataStore {
  private readonly evidence = new Map<string, EvidenceRecord>();
  private readonly notificationsById = new Map<string, NotificationRecord>();
  private readonly audits: AuditRecord[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  async addEvidence(
    evidence: Omit<EvidenceRecord, "id" | "createdAt">,
  ): Promise<EvidenceRecord> {
    const duplicate = [...this.evidence.values()].find(
      (entry) =>
        entry.rental === evidence.rental &&
        entry.evidenceDigest === evidence.evidenceDigest,
    );
    if (duplicate) {
      throw new ConflictError("This evidence digest is already registered.");
    }
    const record: EvidenceRecord = {
      ...evidence,
      id: randomUUID(),
      createdAt: new Date(this.now()).toISOString(),
    };
    this.evidence.set(record.id, record);
    return record;
  }

  async evidenceByRental(rental: string): Promise<EvidenceRecord[]> {
    return [...this.evidence.values()].filter(
      (entry) => entry.rental === rental,
    );
  }

  async evidenceByDigest(
    rental: string,
    digest: string,
  ): Promise<EvidenceRecord | null> {
    return (
      [...this.evidence.values()].find(
        (entry) =>
          entry.rental === rental && entry.evidenceDigest === digest,
      ) ?? null
    );
  }

  async notifications(wallet: string): Promise<NotificationRecord[]> {
    return [...this.notificationsById.values()]
      .filter((entry) => entry.wallet === wallet)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async markNotificationRead(
    wallet: string,
    id: string,
  ): Promise<NotificationRecord | null> {
    const record = this.notificationsById.get(id);
    if (!record || record.wallet !== wallet) return null;
    record.readAt ??= new Date(this.now()).toISOString();
    return record;
  }

  async audit(record: Omit<AuditRecord, "id" | "createdAt">): Promise<void> {
    this.audits.push({
      ...record,
      id: randomUUID(),
      createdAt: new Date(this.now()).toISOString(),
    });
  }

  seedNotification(notification: NotificationRecord): void {
    this.notificationsById.set(notification.id, notification);
  }

  auditRecords(): readonly AuditRecord[] {
    return this.audits;
  }
}

export class InMemoryAuthStore implements AuthStore {
  private readonly challenges = new Map<string, AuthChallenge>();
  private readonly refreshTokens = new Map<string, RefreshTokenRecord>();

  async saveChallenge(challenge: AuthChallenge): Promise<void> {
    this.challenges.set(challenge.id, challenge);
  }

  async takeChallenge(id: string): Promise<AuthChallenge | null> {
    const challenge = this.challenges.get(id) ?? null;
    this.challenges.delete(id);
    return challenge;
  }

  async addRefreshToken(record: RefreshTokenRecord): Promise<void> {
    this.refreshTokens.set(record.tokenHash, record);
  }

  async rotateRefresh(input: {
    currentTokenHash: string;
    nextTokenHash: string;
    nextExpiresAt: number;
    now: number;
  }): Promise<RefreshRotationResult> {
    const current = this.refreshTokens.get(input.currentTokenHash);
    if (!current) return { status: "unknown" };
    if (current.usedAt !== null) {
      this.revokeFamily(current.familyId);
      return { status: "reused" };
    }
    if (current.expiresAt <= input.now) {
      this.revokeFamily(current.familyId);
      return { status: "expired" };
    }

    this.refreshTokens.set(current.tokenHash, {
      ...current,
      usedAt: input.now,
    });
    this.refreshTokens.set(input.nextTokenHash, {
      tokenHash: input.nextTokenHash,
      wallet: current.wallet,
      familyId: current.familyId,
      expiresAt: input.nextExpiresAt,
      usedAt: null,
    });
    return {
      status: "ok",
      wallet: current.wallet,
      familyId: current.familyId,
    };
  }

  async revokeRefreshToken(tokenHash: string): Promise<void> {
    const record = this.refreshTokens.get(tokenHash);
    if (record) this.revokeFamily(record.familyId);
  }

  private revokeFamily(familyId: string): void {
    for (const [tokenHash, record] of this.refreshTokens) {
      if (record.familyId === familyId) {
        this.refreshTokens.delete(tokenHash);
      }
    }
  }
}

type StoredReconciliationRun = ReconciliationResult & {
  cluster: string;
  programId: string;
  status: "completed" | "failed";
  startedAt: string;
  completedAt: string | null;
  error: string | null;
};

type StoredReconciliationFinding = {
  runId: string;
  address: string;
  accountKind: ChainAccountKind;
  finding: "ADDED" | "UPDATED" | "REMOVED";
  oldDataHash: string | null;
  newDataHash: string | null;
};

export class InMemoryIndexerStore implements IndexerStore {
  private readonly states = new Map<string, IndexerRuntimeState>();
  private readonly projections = new Map<
    string,
    ChainAccountProjection & { observedSlot: string }
  >();
  private readonly eventRows = new Map<string, IndexedChainEvent>();
  private readonly runs: StoredReconciliationRun[] = [];
  private readonly findings: StoredReconciliationFinding[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  async indexerState(
    cluster: string,
    programId: string,
  ): Promise<IndexerRuntimeState | null> {
    const state = this.states.get(stateKey(cluster, programId));
    return state ? structuredClone(state) : null;
  }

  async recordIndexerAttempt(input: {
    cluster: string;
    programId: string;
    at: string;
  }): Promise<void> {
    const state = this.stateFor(input.cluster, input.programId, input.at);
    state.lastAttemptAt = input.at;
    state.updatedAt = input.at;
  }

  async applyEventBatch(
    input: EventBatchInput,
  ): Promise<{ inserted: number }> {
    assertValidEventBatch(input);
    const state = this.stateFor(
      input.cluster,
      input.programId,
      new Date(this.now()).toISOString(),
    );
    if (state.lastEventSignature === input.signature) {
      return { inserted: 0 };
    }
    if (state.lastEventSignature !== input.expectedPreviousSignature) {
      throw new Error(
        `Indexer cursor changed before transaction ${input.signature}.`,
      );
    }

    let inserted = 0;
    for (const event of input.events) {
      const key = eventKey(event);
      if (!this.eventRows.has(key)) {
        this.eventRows.set(key, structuredClone(event));
        inserted += 1;
      }
    }
    state.lastEventSignature = input.signature;
    state.lastEventSlot = input.slot;
    state.lastObservedSlot = maxSlot(state.lastObservedSlot, input.slot);
    state.updatedAt = new Date(this.now()).toISOString();
    return { inserted };
  }

  async reconcileSnapshot(
    input: ReconciliationInput,
  ): Promise<ReconciliationResult> {
    assertReconciliationInput(input);
    const startedAt = new Date(this.now()).toISOString();
    const runId = newRunId();
    const desired = new Map(
      input.accounts.map((account) => [
        projectionKey(input.cluster, input.programId, account.address),
        account,
      ]),
    );
    if (desired.size !== input.accounts.length) {
      throw new Error("The snapshot contains duplicate account addresses.");
    }

    let inserted = 0;
    let updated = 0;
    let deleted = 0;
    let unchanged = 0;
    const findings: StoredReconciliationFinding[] = [];

    for (const [key, account] of desired) {
      const existing = this.projections.get(key);
      if (!existing) {
        inserted += 1;
        findings.push({
          runId,
          address: account.address,
          accountKind: account.kind,
          finding: "ADDED",
          oldDataHash: null,
          newDataHash: account.dataHash,
        });
        this.projections.set(key, {
          ...account,
          observedSlot: input.snapshotSlot,
        });
        continue;
      }
      if (
        existing.dataHash === account.dataHash &&
        existing.kind === account.kind
      ) {
        unchanged += 1;
        existing.observedSlot = input.snapshotSlot;
        continue;
      }
      updated += 1;
      findings.push({
        runId,
        address: account.address,
        accountKind: account.kind,
        finding: "UPDATED",
        oldDataHash: existing.dataHash,
        newDataHash: account.dataHash,
      });
      this.projections.set(key, {
        ...account,
        observedSlot: input.snapshotSlot,
      });
    }

    for (const [key, existing] of this.projections) {
      if (desired.has(key)) continue;
      deleted += 1;
      findings.push({
        runId,
        address: existing.address,
        accountKind: existing.kind,
        finding: "REMOVED",
        oldDataHash: existing.dataHash,
        newDataHash: null,
      });
      this.projections.delete(key);
    }

    const result: ReconciliationResult = {
      runId,
      snapshotSlot: input.snapshotSlot,
      inserted,
      updated,
      deleted,
      unchanged,
    };
    this.runs.push({
      ...result,
      cluster: input.cluster,
      programId: input.programId,
      status: "completed",
      startedAt,
      completedAt: new Date(this.now()).toISOString(),
      error: null,
    });
    this.findings.push(...findings);

    const state = this.stateFor(input.cluster, input.programId, startedAt);
    state.lastObservedSlot = maxSlot(
      state.lastObservedSlot,
      input.snapshotSlot,
    );
    state.lastReconciliationAt = new Date(this.now()).toISOString();
    state.updatedAt = state.lastReconciliationAt;
    return result;
  }

  async recordIndexerSuccess(input: {
    cluster: string;
    programId: string;
    observedSlot: string;
    eventScanSlot: string;
    at: string;
  }): Promise<void> {
    const state = this.stateFor(input.cluster, input.programId, input.at);
    state.lastObservedSlot = maxSlot(
      state.lastObservedSlot,
      input.observedSlot,
    );
    state.lastEventScanSlot = maxSlot(
      state.lastEventScanSlot,
      input.eventScanSlot,
    );
    state.lastSuccessAt = input.at;
    state.lastError = null;
    state.updatedAt = input.at;
  }

  async recordIndexerFailure(input: {
    cluster: string;
    programId: string;
    error: string;
    observedSlot: string | null;
    at: string;
  }): Promise<void> {
    const state = this.stateFor(input.cluster, input.programId, input.at);
    if (input.observedSlot !== null) {
      state.lastObservedSlot = maxSlot(
        state.lastObservedSlot,
        input.observedSlot,
      );
    }
    state.lastError = input.error;
    state.updatedAt = input.at;
  }

  events(): readonly IndexedChainEvent[] {
    return [...this.eventRows.values()];
  }

  projection(): ReadonlyArray<ChainAccountProjection & { observedSlot: string }> {
    return [...this.projections.values()].map((entry) =>
      structuredClone(entry),
    );
  }

  reconciliationRuns(): readonly StoredReconciliationRun[] {
    return this.runs;
  }

  reconciliationFindings(): readonly StoredReconciliationFinding[] {
    return this.findings;
  }

  private stateFor(
    cluster: string,
    programId: string,
    at: string,
  ): IndexerRuntimeState {
    const key = stateKey(cluster, programId);
    let state = this.states.get(key);
    if (!state) {
      state = {
        cluster,
        programId,
        lastEventSignature: null,
        lastEventSlot: null,
        lastEventScanSlot: null,
        lastObservedSlot: null,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastReconciliationAt: null,
        lastError: null,
        updatedAt: at,
      };
      this.states.set(key, state);
    }
    return state;
  }
}

function stateKey(cluster: string, programId: string): string {
  return `${cluster}\0${programId}`;
}

function projectionKey(
  cluster: string,
  programId: string,
  address: string,
): string {
  return `${cluster}\0${programId}\0${address}`;
}

function eventKey(event: IndexedChainEvent): string {
  return `${event.cluster}\0${event.programId}\0${event.signature}\0${event.logIndex}`;
}

function maxSlot(current: string | null, next: string): string {
  if (current === null) return next;
  return BigInt(current) >= BigInt(next) ? current : next;
}

export function assertValidEventBatch(input: EventBatchInput): void {
  if (!/^\d+$/.test(input.slot)) {
    throw new Error("Event batch slot must be an unsigned integer.");
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(input.signature)) {
    throw new Error("Event batch signature is malformed.");
  }
  if (
    input.expectedPreviousSignature !== null &&
    !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(input.expectedPreviousSignature)
  ) {
    throw new Error("Previous event batch signature is malformed.");
  }
  for (const event of input.events) {
    if (
      event.cluster !== input.cluster ||
      event.programId !== input.programId ||
      event.signature !== input.signature ||
      event.slot !== input.slot ||
      event.blockTime !== input.blockTime
    ) {
      throw new Error("Event batch metadata is inconsistent.");
    }
    assertValidEvent(event);
  }
}

function assertValidEvent(event: IndexedChainEvent): void {
  if (
    !Number.isInteger(event.logIndex) ||
    event.logIndex < 0 ||
    !Number.isInteger(event.action) ||
    event.action < 0 ||
    event.action > 13 ||
    !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(event.signature) ||
    !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(event.subject) ||
    !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(event.owner) ||
    !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(event.actor) ||
    !/^\d+$/.test(event.amount) ||
    !/^-?\d+$/.test(event.timestamp) ||
    !/^\d+$/.test(event.slot) ||
    (event.blockTime !== null && !/^-?\d+$/.test(event.blockTime)) ||
    !/^[0-9a-f]{64}$/.test(event.digest)
  ) {
    throw new Error("The event batch contains malformed event data.");
  }
}

export function assertReconciliationInput(input: ReconciliationInput): void {
  if (!/^\d+$/.test(input.snapshotSlot)) {
    throw new Error("Reconciliation slot must be an unsigned integer.");
  }
  for (const account of input.accounts) {
    if (
      !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(account.address) ||
      !/^[0-9a-f]{64}$/.test(account.dataHash)
    ) {
      throw new Error("The reconciliation input contains malformed accounts.");
    }
  }
}
