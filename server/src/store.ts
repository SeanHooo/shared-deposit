import { randomUUID } from "node:crypto";
import { ConflictError } from "./errors.js";

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
