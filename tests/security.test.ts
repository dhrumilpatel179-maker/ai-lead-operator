import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  approveAndSimulateSend,
  type ApprovalRepository,
  type DraftForAction,
  type SendReceipt,
} from "../lib/approval-service.ts";
import { authenticatedEmail, HttpError, type RequestContext } from "../lib/security.ts";
import { GET as getInquiries } from "../app/api/inquiries/route.ts";
import { POST as postDraftAction } from "../app/api/draft-actions/route.ts";

type Ledger = {
  approvals: ReadonlyArray<Readonly<Record<string, unknown>>>;
  sends: ReadonlyArray<Readonly<Record<string, unknown>>>;
  messages: ReadonlyArray<Readonly<Record<string, unknown>>>;
  followUps: ReadonlyArray<Readonly<Record<string, unknown>>>;
  audits: ReadonlyArray<Readonly<Record<string, unknown>>>;
};

class MemoryApprovalRepository implements ApprovalRepository {
  drafts = new Map<string, DraftForAction>();
  ledger: Ledger = { approvals: [], sends: [], messages: [], followUps: [], audits: [] };
  failCommit = false;

  addDraft(draft: DraftForAction) {
    this.drafts.set(`${draft.tenantId}:${draft.id}`, { ...draft });
  }

  async findDraft(tenantId: string, draftId: string) {
    return this.drafts.get(`${tenantId}:${draftId}`) ?? null;
  }

  async findSendByIdempotency(tenantId: string, idempotencyKey: string): Promise<SendReceipt | null> {
    const send = this.ledger.sends.find((entry) =>
      entry.tenantId === tenantId && entry.idempotencyKey === idempotencyKey,
    );
    if (!send) return null;
    return {
      operationId: String(send.operationId),
      leadId: String(send.leadId),
      draftId: String(send.draftId),
      state: "sent",
      sentAt: String(send.sentAt),
      idempotentReplay: true,
    };
  }

  async recordDeniedDraftAccess(input: Parameters<ApprovalRepository["recordDeniedDraftAccess"]>[0]) {
    if (this.failCommit) throw new Error("database unavailable");
    this.ledger = {
      ...this.ledger,
      audits: [...this.ledger.audits, Object.freeze({
        action: "draft_access_denied",
        tenantId: input.context.tenantId,
        targetId: input.draftId,
      })],
    };
  }

  async commitBlockedAttempt(input: Parameters<ApprovalRepository["commitBlockedAttempt"]>[0]) {
    if (this.failCommit) throw new Error("database unavailable");
    const stored = this.drafts.get(`${input.context.tenantId}:${input.draft.id}`);
    if (!stored || stored.state !== "pending") throw new Error("invalid transition");
    stored.state = "blocked";
    this.ledger = {
      ...this.ledger,
      approvals: [...this.ledger.approvals, Object.freeze({ decision: "blocked", tenantId: input.context.tenantId })],
      audits: [...this.ledger.audits, Object.freeze({ action: "approve_send_blocked", tenantId: input.context.tenantId })],
    };
  }

  async commitApprovalAndSimulatedSend(input: Parameters<ApprovalRepository["commitApprovalAndSimulatedSend"]>[0]) {
    if (this.failCommit) throw new Error("database unavailable");
    const key = `${input.context.tenantId}:${input.draft.id}`;
    const stored = this.drafts.get(key);
    if (!stored || stored.state !== "pending") throw new Error("invalid transition");
    const operationId = `send_${input.draft.id}`;
    const nextLedger: Ledger = {
      approvals: [...this.ledger.approvals, Object.freeze({ decision: "approved", tenantId: input.context.tenantId, draftId: input.draft.id })],
      sends: [...this.ledger.sends, Object.freeze({ operationId, tenantId: input.context.tenantId, leadId: input.draft.leadId, draftId: input.draft.id, idempotencyKey: input.idempotencyKey, sentAt: input.occurredAt })],
      messages: [...this.ledger.messages, Object.freeze({ direction: "outbound", tenantId: input.context.tenantId, operationId })],
      followUps: [...this.ledger.followUps, Object.freeze({ tenantId: input.context.tenantId, operationId, dueAt: input.followUpAt })],
      audits: [...this.ledger.audits, Object.freeze({ action: "draft_approved_and_simulated_send_committed", tenantId: input.context.tenantId, operationId })],
    };
    stored.state = "sent";
    stored.body = input.body;
    this.ledger = nextLedger;
    return {
      operationId,
      leadId: input.draft.leadId,
      draftId: input.draft.id,
      state: "sent" as const,
      sentAt: input.occurredAt,
      idempotentReplay: false,
    };
  }
}

function context(tenantId: string, role: RequestContext["role"] = "manager"): RequestContext {
  return {
    tenantId,
    tenantName: tenantId,
    actorId: `${role}@example.com`,
    role,
    authenticationSource: "sites-siwc",
  };
}

function draft(overrides: Partial<DraftForAction> = {}): DraftForAction {
  return {
    id: "draft_001",
    tenantId: "tenant_a",
    leadId: "lead_001",
    body: "Thanks for contacting us.",
    draftAuthority: "green",
    leadAuthority: "green",
    state: "pending",
    ...overrides,
  };
}

test("production request identity rejects missing authentication and normalizes email", () => {
  assert.throws(
    () => authenticatedEmail(new Request("https://app.test/api")),
    (error: unknown) => error instanceof HttpError && error.status === 401,
  );
  assert.equal(authenticatedEmail(new Request("https://app.test/api", {
    headers: { "oai-authenticated-user-email": "  Owner@Example.COM " },
  })), "owner@example.com");
});

test("API routes reject unauthenticated requests before touching persistence", async () => {
  const inquiryResponse = await getInquiries(new Request("https://app.test/api/inquiries"));
  const actionResponse = await postDraftAction(new Request("https://app.test/api/draft-actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "approve_send" }),
  }));
  assert.equal(inquiryResponse.status, 401);
  assert.equal(actionResponse.status, 401);
});

test("cross-tenant draft identifiers return a generic not-found and only audit the denial", async () => {
  const repository = new MemoryApprovalRepository();
  repository.addDraft(draft());
  await assert.rejects(
    approveAndSimulateSend(repository, {
      context: context("tenant_b"), draftId: "draft_001",
      body: "Thanks for contacting us.", idempotencyKey: "request_001",
    }),
    (error: unknown) => error instanceof HttpError && error.status === 404 && error.code === "draft_not_found",
  );
  assert.equal(repository.ledger.approvals.length, 0);
  assert.equal(repository.ledger.sends.length, 0);
  assert.equal(repository.ledger.messages.length, 0);
  assert.equal(repository.ledger.followUps.length, 0);
  assert.deepEqual(repository.ledger.audits, [Object.freeze({
    action: "draft_access_denied", tenantId: "tenant_b", targetId: "draft_001",
  })]);
});

test("viewer role cannot approve or send", async () => {
  const repository = new MemoryApprovalRepository();
  repository.addDraft(draft());
  await assert.rejects(
    approveAndSimulateSend(repository, {
      context: context("tenant_a", "viewer"), draftId: "draft_001",
      body: "Thanks for contacting us.", idempotencyKey: "request_002",
    }),
    (error: unknown) => error instanceof HttpError && error.code === "role_forbidden",
  );
  assert.equal(repository.ledger.sends.length, 0);
});

test("edited red content cannot bypass a green draft and is durably blocked", async () => {
  const repository = new MemoryApprovalRepository();
  repository.addDraft(draft());
  await assert.rejects(
    approveAndSimulateSend(repository, {
      context: context("tenant_a"), draftId: "draft_001",
      body: "The problem is the fuel pump. I guarantee the repair price.",
      idempotencyKey: "request_003",
    }),
    (error: unknown) => error instanceof HttpError && error.code === "red_action_blocked",
  );
  assert.equal(repository.ledger.sends.length, 0);
  assert.equal(repository.ledger.messages.length, 0);
  assert.equal(repository.ledger.approvals.length, 1);
  assert.equal(repository.ledger.audits.length, 1);
  assert.equal((await repository.findDraft("tenant_a", "draft_001"))?.state, "blocked");
});

test("approve/send is idempotent and commits one approval, send, message, follow-up, and audit", async () => {
  const repository = new MemoryApprovalRepository();
  repository.addDraft(draft({ draftAuthority: "yellow" }));
  const input = {
    context: context("tenant_a", "advisor"), draftId: "draft_001",
    body: "A team member can suggest an appointment window.",
    idempotencyKey: "request_004", now: new Date("2026-07-21T12:00:00.000Z"),
  };
  const first = await approveAndSimulateSend(repository, input);
  const replay = await approveAndSimulateSend(repository, input);
  assert.equal(first.operationId, replay.operationId);
  assert.equal(first.idempotentReplay, false);
  assert.equal(replay.idempotentReplay, true);
  assert.deepEqual({
    approvals: repository.ledger.approvals.length,
    sends: repository.ledger.sends.length,
    messages: repository.ledger.messages.length,
    followUps: repository.ledger.followUps.length,
    audits: repository.ledger.audits.length,
  }, { approvals: 1, sends: 1, messages: 1, followUps: 1, audits: 1 });
});

test("audit ledger records are immutable through the workflow surface", async () => {
  const repository = new MemoryApprovalRepository();
  repository.addDraft(draft());
  await approveAndSimulateSend(repository, {
    context: context("tenant_a"), draftId: "draft_001",
    body: "Thanks for contacting us.", idempotencyKey: "request_005",
  });
  const event = repository.ledger.audits[0];
  assert.equal(Object.isFrozen(event), true);
  assert.equal(Reflect.set(event, "action", "tampered"), false);
  assert.equal(event.action, "draft_approved_and_simulated_send_committed");
});

test("persistence failure fails closed with no success artifacts", async () => {
  const repository = new MemoryApprovalRepository();
  repository.addDraft(draft());
  repository.failCommit = true;
  await assert.rejects(
    approveAndSimulateSend(repository, {
      context: context("tenant_a"), draftId: "draft_001",
      body: "Thanks for contacting us.", idempotencyKey: "request_006",
    }),
    /database unavailable/,
  );
  assert.equal((await repository.findDraft("tenant_a", "draft_001"))?.state, "pending");
  assert.deepEqual(repository.ledger, { approvals: [], sends: [], messages: [], followUps: [], audits: [] });
});

test("production RLS is role-aware and consequential tables have no browser write policy", async () => {
  const sql = await readFile(new URL("../db/supabase-production.sql", import.meta.url), "utf8");
  assert.match(sql, /create policy leads_writer_update[\s\S]*public\.can_write_tenant\(tenant_id\)/i);
  assert.doesNotMatch(sql, /create policy drafts_\w+_update/i);
  assert.doesNotMatch(sql, /create policy followups_\w+_update/i);
  assert.match(sql, /revoke all on public\.tenant_memberships,[\s\S]*public\.audit_events/i);
  assert.match(sql, /create trigger audit_events_immutable/i);
  assert.match(sql, /actor_role text not null check \(actor_role in \('owner','manager','advisor','viewer'\)\)/i);
});
