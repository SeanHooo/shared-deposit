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
