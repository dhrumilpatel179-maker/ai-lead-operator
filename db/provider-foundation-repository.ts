export type ProviderSendOutboxState =
  | "queued"
  | "claimed"
  | "sending"
  | "sent"
  | "failed"
  | "needs_reconciliation"
  | "cancelled";

type D1Value = string | number | null;

export interface D1ResultLike {
  meta: { changes?: number };
  success?: boolean;
}

export interface D1StatementLike {
  bind(...values: D1Value[]): D1StatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1ResultLike>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1StatementLike;
  batch(statements: D1StatementLike[]): Promise<D1ResultLike[]>;
}

export interface ProviderOutboxRow {
  id: string;
  tenantId: string;
  state: ProviderSendOutboxState;
  attemptCount: number;
  claimToken: string | null;
  claimedAt: string | null;
  claimExpiresAt: string | null;
  providerMessageId: string | null;
  approvedBodyHash: string;
}

export interface EnqueueProviderSendInput {
  id: string;
  tenantId: string;
  connectionId: string;
  leadId: string;
  draftId: string;
  approvalId: string;
  idempotencyKey: string;
  approvedBodyHash: string;
  nextAttemptAt: string;
  createdAt: string;
  deletionDueAt: string;
}

function changes(result: D1ResultLike): number {
  return result.meta.changes ?? 0;
}

export class D1ProviderFoundationRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async findOutbox(tenantId: string, outboxId: string): Promise<ProviderOutboxRow | null> {
    return this.db.prepare(`
      SELECT
        id,
        tenant_id AS tenantId,
        state,
        attempt_count AS attemptCount,
        claim_token AS claimToken,
        claimed_at AS claimedAt,
        claim_expires_at AS claimExpiresAt,
        provider_message_id AS providerMessageId,
        approved_body_hash AS approvedBodyHash
      FROM provider_send_outbox
      WHERE tenant_id = ? AND id = ?
    `).bind(tenantId, outboxId).first<ProviderOutboxRow>();
  }

  async enqueueProviderSend(input: EnqueueProviderSendInput): Promise<ProviderOutboxRow> {
    const result = await this.db.prepare(`
      INSERT INTO provider_send_outbox (
        id, tenant_id, connection_id, lead_id, draft_id, approval_id,
        idempotency_key, approved_body_hash, state, attempt_count,
        next_attempt_at, created_at, updated_at, deletion_due_at
      )
      SELECT
        ?, approval.tenant_id, connection.id, lead.id, draft.id, approval.id,
        ?, ?, 'queued', 0, ?, ?, ?, ?
      FROM approval_events AS approval
      JOIN response_drafts AS draft
        ON draft.tenant_id = approval.tenant_id
        AND draft.id = approval.draft_id
        AND draft.lead_id = approval.lead_id
      JOIN leads AS lead
        ON lead.tenant_id = approval.tenant_id
        AND lead.id = approval.lead_id
      JOIN provider_connections AS connection
        ON connection.tenant_id = approval.tenant_id
        AND connection.id = ?
        AND connection.status = 'active'
      WHERE approval.tenant_id = ?
        AND approval.id = ?
        AND approval.lead_id = ?
        AND approval.draft_id = ?
        AND approval.decision = 'approved'
        AND approval.body_hash = ?
    `).bind(
      input.id,
      input.idempotencyKey,
      input.approvedBodyHash,
      input.nextAttemptAt,
      input.createdAt,
      input.createdAt,
      input.deletionDueAt,
      input.connectionId,
      input.tenantId,
      input.approvalId,
      input.leadId,
      input.draftId,
      input.approvedBodyHash,
    ).run();
    if (changes(result) !== 1) {
      throw new Error("Provider send tenant or approval chain is invalid");
    }
    const stored = await this.findOutbox(input.tenantId, input.id);
    if (!stored) throw new Error("Provider send intent was not persisted");
    return stored;
  }

  async recoverExpiredClaims(tenantId: string, now: string): Promise<{
    recoveredBeforeSend: number;
    needsReconciliation: number;
  }> {
    const [acknowledgementUnknown, notYetSending] = await this.db.batch([
      this.db.prepare(`
        UPDATE provider_send_outbox
        SET
          state = 'needs_reconciliation',
          claim_token = NULL,
          claimed_at = NULL,
          claim_expires_at = NULL,
          updated_at = ?
        WHERE tenant_id = ?
          AND state = 'sending'
          AND claim_expires_at <= ?
      `).bind(now, tenantId, now),
      this.db.prepare(`
        UPDATE provider_send_outbox
        SET
          state = 'queued',
          claim_token = NULL,
          claimed_at = NULL,
          claim_expires_at = NULL,
          updated_at = ?
        WHERE tenant_id = ?
          AND state = 'claimed'
          AND claim_expires_at <= ?
      `).bind(now, tenantId, now),
    ]);
    return {
      recoveredBeforeSend: changes(notYetSending),
      needsReconciliation: changes(acknowledgementUnknown),
    };
  }

  async claimNext(input: {
    tenantId: string;
    outboxId: string;
    claimToken: string;
    claimedAt: string;
    claimExpiresAt: string;
  }): Promise<ProviderOutboxRow | null> {
    return this.db.prepare(`
      UPDATE provider_send_outbox
      SET
        state = 'claimed',
        claim_token = ?,
        claimed_at = ?,
        claim_expires_at = ?,
        attempt_count = attempt_count + 1,
        updated_at = ?
      WHERE tenant_id = ?
        AND id = ?
        AND state = 'queued'
        AND next_attempt_at <= ?
      RETURNING
        id,
        tenant_id AS tenantId,
        state,
        attempt_count AS attemptCount,
        claim_token AS claimToken,
        claimed_at AS claimedAt,
        claim_expires_at AS claimExpiresAt,
        provider_message_id AS providerMessageId,
        approved_body_hash AS approvedBodyHash
    `).bind(
      input.claimToken,
      input.claimedAt,
      input.claimExpiresAt,
      input.claimedAt,
      input.tenantId,
      input.outboxId,
      input.claimedAt,
    ).first<ProviderOutboxRow>();
  }

  async beginSending(input: {
    tenantId: string;
    outboxId: string;
    claimToken: string;
    occurredAt: string;
  }): Promise<boolean> {
    const result = await this.db.prepare(`
      UPDATE provider_send_outbox
      SET state = 'sending', updated_at = ?
      WHERE tenant_id = ?
        AND id = ?
        AND state = 'claimed'
        AND claim_token = ?
        AND claim_expires_at > ?
    `).bind(
      input.occurredAt,
      input.tenantId,
      input.outboxId,
      input.claimToken,
      input.occurredAt,
    ).run();
    return changes(result) === 1;
  }

  async markSent(input: {
    tenantId: string;
    outboxId: string;
    claimToken: string;
    providerMessageId: string;
    occurredAt: string;
  }): Promise<boolean> {
    const result = await this.db.prepare(`
      UPDATE provider_send_outbox
      SET
        state = 'sent',
        provider_message_id = ?,
        claim_token = NULL,
        claimed_at = NULL,
        claim_expires_at = NULL,
        updated_at = ?
      WHERE tenant_id = ?
        AND id = ?
        AND state = 'sending'
        AND claim_token = ?
    `).bind(
      input.providerMessageId,
      input.occurredAt,
      input.tenantId,
      input.outboxId,
      input.claimToken,
    ).run();
    return changes(result) === 1;
  }

  async markAcknowledgementLost(input: {
    tenantId: string;
    outboxId: string;
    claimToken: string;
    occurredAt: string;
  }): Promise<boolean> {
    const result = await this.db.prepare(`
      UPDATE provider_send_outbox
      SET
        state = 'needs_reconciliation',
        claim_token = NULL,
        claimed_at = NULL,
        claim_expires_at = NULL,
        updated_at = ?
      WHERE tenant_id = ?
        AND id = ?
        AND state = 'sending'
        AND claim_token = ?
    `).bind(
      input.occurredAt,
      input.tenantId,
      input.outboxId,
      input.claimToken,
    ).run();
    return changes(result) === 1;
  }
}
