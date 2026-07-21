import { D1ApprovalRepository } from "../../../db/approval-repository";
import { getDb } from "../../../db";
import { approveAndSimulateSend } from "../../../lib/approval-service";
import { authenticatedEmail, errorResponse, HttpError, requireRole, resolveRequestContext } from "../../../lib/security";

type ActionPayload = {
  action?: "approve_send" | "escalate";
  draftId?: string;
  body?: string;
  idempotencyKey?: string;
};

export async function POST(request: Request) {
  try {
    authenticatedEmail(request);
    const db = await getDb();
    const context = await resolveRequestContext(request, db);
    const payload = await request.json() as ActionPayload;
    if (!payload.draftId || !payload.idempotencyKey || !["approve_send", "escalate"].includes(payload.action ?? "")) {
      return Response.json(
        { error: "invalid_action", message: "A supported action, draftId, and idempotencyKey are required." },
        { status: 400 },
      );
    }

    const repository = new D1ApprovalRepository();
    if (payload.action === "escalate") {
      requireRole(context, ["owner", "manager", "advisor"]);
      const draft = await repository.findDraft(context.tenantId, payload.draftId);
      if (!draft) throw new HttpError(404, "draft_not_found", "Draft not found.");
      const receipt = await repository.commitEscalation({
        context: { ...context, role: context.role as "owner" | "manager" | "advisor" },
        draft,
        idempotencyKey: payload.idempotencyKey,
        occurredAt: new Date().toISOString(),
      });
      return Response.json({ receipt, persisted: true });
    }

    const receipt = await approveAndSimulateSend(repository, {
      context,
      draftId: payload.draftId,
      body: payload.body ?? "",
      idempotencyKey: payload.idempotencyKey,
    });
    return Response.json({ receipt, persisted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
