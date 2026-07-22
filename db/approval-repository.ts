import { and, eq } from "drizzle-orm";
import type { ApprovalRepository, DraftForAction, SendReceipt } from "../lib/approval-service";
import { getD1, getDb } from ".";
import { leads, responseDrafts, sendOperations } from "./schema";

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class D1ApprovalRepository implements ApprovalRepository {
  async findDraft(tenantId: string, draftId: string): Promise<DraftForAction | null> {
    const db = await getDb();
    const rows = await db
      .select({
        id: responseDrafts.id,
        tenantId: responseDrafts.tenantId,
        leadId: responseDrafts.leadId,
        body: responseDrafts.body,
        draftAuthority: responseDrafts.authority,
        leadAuthority: leads.authority,
        state: responseDrafts.state,
      })
      .from(responseDrafts)
      .innerJoin(
        leads,
        and(
          eq(leads.id, responseDrafts.leadId),
          eq(leads.tenantId, responseDrafts.tenantId),
        ),
      )
      .where(and(eq(responseDrafts.id, draftId), eq(responseDrafts.tenantId, tenantId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findSendByIdempotency(tenantId: string, idempotencyKey: string): Promise<SendReceipt | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(sendOperations)
      .where(and(
        eq(sendOperations.tenantId, tenantId),
        eq(sendOperations.idempotencyKey, idempotencyKey),
        eq(sendOperations.state, "sent"),
      ))
      .limit(1);
    const operation = rows[0];
    if (!operation?.sentAt) return null;
    return {
      operationId: operation.id,
      leadId: operation.leadId,
      draftId: operation.draftId,
      state: "sent",
      sentAt: operation.sentAt,
      idempotentReplay: true,
    };
  }

  async recordDeniedDraftAccess(input: Parameters<ApprovalRepository["recordDeniedDraftAccess"]>[0]): Promise<void> {
    const d1 = await getD1();
    await d1.prepare(`
      INSERT INTO audit_events
        (id, tenant_id, lead_id, actor_type, actor_id, action, actor_role, target_type, target_id, correlation_id, details_json, created_at)
      VALUES (?, ?, NULL, 'user', ?, 'draft_access_denied', ?, 'draft', ?, ?, '{"result":"not_found"}', ?)
      ON CONFLICT (tenant_id, correlation_id, action) DO NOTHING
    `).bind(
      id("audit"), input.context.tenantId, input.context.actorId, input.context.role,
      input.draftId, input.correlationId, input.occurredAt,
    ).run();
  }

  async commitEscalation(input: {
    context: { tenantId: string; actorId: string; role: "owner" | "manager" | "advisor" };
    draft: DraftForAction;
    idempotencyKey: string;
    occurredAt: string;
  }): Promise<{ leadId: string; draftId: string; state: "escalated"; occurredAt: string }> {
    const d1 = await getD1();
    const auditId = id("audit");
    await d1.batch([
      d1.prepare(`
        UPDATE response_drafts
        SET state = 'blocked', transition_token = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND state IN ('pending', 'blocked')
      `).bind(input.idempotencyKey, input.occurredAt, input.draft.id, input.context.tenantId),
      d1.prepare(`
        UPDATE leads
        SET status = 'Escalated', next_action = 'Human review', updated_at = ?
        WHERE id = ? AND tenant_id = ?
          AND EXISTS (
            SELECT 1 FROM response_drafts
            WHERE id = ? AND tenant_id = ? AND transition_token = ?
          )
      `).bind(
        input.occurredAt, input.draft.leadId, input.context.tenantId,
        input.draft.id, input.context.tenantId, input.idempotencyKey,
      ),
      d1.prepare(`
        INSERT INTO audit_events
          (id, tenant_id, lead_id, actor_type, actor_id, action, authority, actor_role, target_type, target_id, correlation_id, details_json, created_at)
        SELECT ?, tenant_id, lead_id, 'user', ?, 'draft_escalated_to_human', authority, ?, 'draft', id, ?, '{}', ?
        FROM response_drafts
        WHERE id = ? AND tenant_id = ? AND transition_token = ?
        ON CONFLICT (tenant_id, correlation_id, action) DO NOTHING
      `).bind(
        auditId, input.context.actorId, input.context.role, input.idempotencyKey,
        input.occurredAt, input.draft.id, input.context.tenantId, input.idempotencyKey,
      ),
    ]);
    return {
      leadId: input.draft.leadId,
      draftId: input.draft.id,
      state: "escalated",
      occurredAt: input.occurredAt,
    };
  }

  async commitBlockedAttempt(input: Parameters<ApprovalRepository["commitBlockedAttempt"]>[0]): Promise<void> {
    const d1 = await getD1();
    const bodyHash = await sha256(input.body);
    const approvalId = id("approval");
    const auditId = id("audit");
    const result = await d1.batch([
      d1.prepare(`
        UPDATE response_drafts
        SET state = 'blocked', transition_token = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND state = 'pending'
      `).bind(input.idempotencyKey, input.occurredAt, input.draft.id, input.context.tenantId),
      d1.prepare(`
        INSERT INTO approval_events
          (id, tenant_id, lead_id, draft_id, decision, actor_id, actor_role, authority, body_hash, idempotency_key, created_at)
        SELECT ?, tenant_id, lead_id, id, 'blocked', ?, ?, 'red', ?, ?, ?
        FROM response_drafts
        WHERE id = ? AND tenant_id = ? AND state = 'blocked' AND transition_token = ?
      `).bind(
        approvalId, input.context.actorId, input.context.role, bodyHash,
        input.idempotencyKey, input.occurredAt, input.draft.id,
        input.context.tenantId, input.idempotencyKey,
      ),
      d1.prepare(`
        INSERT INTO audit_events
          (id, tenant_id, lead_id, actor_type, actor_id, action, authority, actor_role, target_type, target_id, correlation_id, details_json, created_at)
        SELECT ?, tenant_id, lead_id, 'user', ?, 'approve_send_blocked', 'red', ?, 'draft', id, ?, ?, ?
        FROM response_drafts
        WHERE id = ? AND tenant_id = ? AND state = 'blocked' AND transition_token = ?
      `).bind(
        auditId, input.context.actorId, input.context.role, input.idempotencyKey,
        JSON.stringify({ reason: "red_authority", bodyHash }), input.occurredAt,
        input.draft.id, input.context.tenantId, input.idempotencyKey,
      ),
    ]);
    if ((result[0].meta.changes ?? 0) !== 1) {
      throw new Error("Blocked transition did not commit exactly once");
    }
  }

  async commitApprovalAndSimulatedSend(
    input: Parameters<ApprovalRepository["commitApprovalAndSimulatedSend"]>[0],
  ): Promise<SendReceipt> {
    const d1 = await getD1();
    const bodyHash = await sha256(input.body);
    const approvalId = id("approval");
    const operationId = id("send");
    const messageId = id("msg");
    const followUpId = id("followup");
    const auditId = id("audit");
    const providerMessageId = `sim_${crypto.randomUUID()}`;

    try {
      const result = await d1.batch([
        d1.prepare(`
          UPDATE response_drafts
          SET body = ?, state = 'sent', approved_by = ?, approved_at = ?, transition_token = ?, updated_at = ?
          WHERE id = ? AND tenant_id = ? AND state = 'pending' AND authority <> 'red'
        `).bind(
          input.body, input.context.actorId, input.occurredAt, input.idempotencyKey, input.occurredAt,
          input.draft.id, input.context.tenantId,
        ),
        d1.prepare(`
          INSERT INTO approval_events
            (id, tenant_id, lead_id, draft_id, decision, actor_id, actor_role, authority, body_hash, idempotency_key, created_at)
          SELECT ?, tenant_id, lead_id, id, 'approved', ?, ?, ?, ?, ?, ?
          FROM response_drafts
          WHERE id = ? AND tenant_id = ? AND state = 'sent' AND transition_token = ?
        `).bind(
          approvalId, input.context.actorId, input.context.role, input.authority,
          bodyHash, input.idempotencyKey, input.occurredAt, input.draft.id,
          input.context.tenantId, input.idempotencyKey,
        ),
        d1.prepare(`
          INSERT INTO send_operations
            (id, tenant_id, lead_id, draft_id, idempotency_key, payload_hash, state, transport, provider_message_id, created_at, sent_at)
          SELECT ?, tenant_id, lead_id, id, ?, ?, 'sent', 'simulation', ?, ?, ?
          FROM response_drafts
          WHERE id = ? AND tenant_id = ? AND state = 'sent' AND transition_token = ?
        `).bind(
          operationId, input.idempotencyKey, bodyHash, providerMessageId,
          input.occurredAt, input.occurredAt, input.draft.id,
          input.context.tenantId, input.idempotencyKey,
        ),
        d1.prepare(`
          INSERT INTO messages
            (id, tenant_id, lead_id, direction, channel, body, send_state, idempotency_key, sent_at, created_at)
          SELECT ?, tenant_id, lead_id, 'outbound', 'simulation', ?, 'sent', ?, ?, ?
          FROM response_drafts
          WHERE id = ? AND tenant_id = ? AND state = 'sent' AND transition_token = ?
        `).bind(
          messageId, input.body, input.idempotencyKey, input.occurredAt,
          input.occurredAt, input.draft.id, input.context.tenantId, input.idempotencyKey,
        ),
        d1.prepare(`
          INSERT INTO follow_ups
            (id, tenant_id, lead_id, due_at, state, source_send_operation_id, created_at)
          SELECT ?, tenant_id, lead_id, ?, 'scheduled', ?, ?
          FROM response_drafts
          WHERE id = ? AND tenant_id = ? AND state = 'sent' AND transition_token = ?
        `).bind(
          followUpId, input.followUpAt, operationId, input.occurredAt,
          input.draft.id, input.context.tenantId, input.idempotencyKey,
        ),
        d1.prepare(`
          UPDATE leads
          SET status = 'Qualified', next_action = 'Live sending disabled', next_follow_up = ?, updated_at = ?
          WHERE id = ? AND tenant_id = ?
            AND EXISTS (
              SELECT 1 FROM response_drafts
              WHERE id = ? AND tenant_id = ? AND state = 'sent' AND transition_token = ?
            )
        `).bind(
          input.followUpAt, input.occurredAt, input.draft.leadId,
          input.context.tenantId, input.draft.id, input.context.tenantId,
          input.idempotencyKey,
        ),
        d1.prepare(`
          INSERT INTO audit_events
            (id, tenant_id, lead_id, actor_type, actor_id, action, authority, actor_role, target_type, target_id, correlation_id, details_json, created_at)
          SELECT ?, tenant_id, lead_id, 'user', ?, 'draft_approved_and_simulated_send_committed', ?, ?, 'send_operation', ?, ?, ?, ?
          FROM response_drafts
          WHERE id = ? AND tenant_id = ? AND state = 'sent' AND transition_token = ?
        `).bind(
          auditId, input.context.actorId, input.authority, input.context.role,
          operationId, input.idempotencyKey,
          JSON.stringify({ bodyHash, followUpAt: input.followUpAt, transport: "simulation" }),
          input.occurredAt, input.draft.id, input.context.tenantId, input.idempotencyKey,
        ),
      ]);
      if ((result[0].meta.changes ?? 0) !== 1) {
        throw new Error("Approval transition did not commit exactly once");
      }
    } catch (error) {
      const replay = await this.findSendByIdempotency(
        input.context.tenantId,
        input.idempotencyKey,
      );
      if (replay) return { ...replay, idempotentReplay: true };
      throw error;
    }

    return {
      operationId,
      leadId: input.draft.leadId,
      draftId: input.draft.id,
      state: "sent",
      sentAt: input.occurredAt,
      idempotentReplay: false,
    };
  }
}
