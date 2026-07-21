import { classifyOutboundContent, highestAuthority } from "./action-policy";
import { HttpError, requireRole, type RequestContext } from "./security";
import type { AuthorityLevel } from "./workflow";

export type DraftForAction = {
  id: string;
  tenantId: string;
  leadId: string;
  body: string;
  draftAuthority: AuthorityLevel;
  leadAuthority: AuthorityLevel;
  state: "pending" | "approved" | "rejected" | "sent" | "blocked";
};

export type SendReceipt = {
  operationId: string;
  leadId: string;
  draftId: string;
  state: "sent";
  sentAt: string;
  idempotentReplay: boolean;
};

export type ApproveSendInput = {
  context: RequestContext;
  draftId: string;
  body: string;
  idempotencyKey: string;
  now?: Date;
};

export interface ApprovalRepository {
  findDraft(tenantId: string, draftId: string): Promise<DraftForAction | null>;
  findSendByIdempotency(tenantId: string, idempotencyKey: string): Promise<SendReceipt | null>;
  recordDeniedDraftAccess(input: {
    context: RequestContext;
    draftId: string;
    correlationId: string;
    occurredAt: string;
  }): Promise<void>;
  commitBlockedAttempt(input: {
    context: RequestContext;
    draft: DraftForAction;
    body: string;
    idempotencyKey: string;
    authority: "red";
    occurredAt: string;
  }): Promise<void>;
  commitApprovalAndSimulatedSend(input: {
    context: RequestContext;
    draft: DraftForAction;
    body: string;
    idempotencyKey: string;
    authority: Exclude<AuthorityLevel, "red">;
    occurredAt: string;
    followUpAt: string;
  }): Promise<SendReceipt>;
}

export async function approveAndSimulateSend(
  repository: ApprovalRepository,
  input: ApproveSendInput,
): Promise<SendReceipt> {
  requireRole(input.context, ["owner", "manager", "advisor"]);
  const body = input.body.trim();
  if (!body || body.length > 10_000) {
    throw new HttpError(400, "invalid_draft_body", "Draft body is required and must be under 10,000 characters.");
  }
  if (!/^[A-Za-z0-9:_-]{8,128}$/.test(input.idempotencyKey)) {
    throw new HttpError(400, "invalid_idempotency_key", "A valid idempotency key is required.");
  }

  const replay = await repository.findSendByIdempotency(
    input.context.tenantId,
    input.idempotencyKey,
  );
  if (replay) return { ...replay, idempotentReplay: true };

  const draft = await repository.findDraft(input.context.tenantId, input.draftId);
  if (!draft) {
    await repository.recordDeniedDraftAccess({
      context: input.context,
      draftId: input.draftId,
      correlationId: input.idempotencyKey,
      occurredAt: (input.now ?? new Date()).toISOString(),
    });
    throw new HttpError(404, "draft_not_found", "Draft not found.");
  }
  if (draft.state !== "pending") {
    throw new HttpError(409, "invalid_draft_state", "Only pending drafts can be approved.");
  }

  const authority = highestAuthority(
    draft.draftAuthority,
    draft.leadAuthority,
    classifyOutboundContent(body),
  );
  const now = input.now ?? new Date();
  const occurredAt = now.toISOString();

  if (authority === "red") {
    await repository.commitBlockedAttempt({
      context: input.context,
      draft,
      body,
      idempotencyKey: input.idempotencyKey,
      authority,
      occurredAt,
    });
    throw new HttpError(403, "red_action_blocked", "Red actions always require a separate human-controlled workflow.");
  }

  const followUpAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  return repository.commitApprovalAndSimulatedSend({
    context: input.context,
    draft,
    body,
    idempotencyKey: input.idempotencyKey,
    authority,
    occurredAt,
    followUpAt,
  });
}
