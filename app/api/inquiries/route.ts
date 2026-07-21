import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditEvents, followUps, leads, messages, responseDrafts } from "../../../db/schema";
import { processInquiry, type InquiryInput, type Lead } from "../../../lib/workflow";
import { authenticatedEmail, errorResponse, requireRole, resolveRequestContext } from "../../../lib/security";

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export async function GET(request: Request) {
  try {
    authenticatedEmail(request);
    const db = await getDb();
    const context = await resolveRequestContext(request, db);
    const [rows, drafts, audits] = await Promise.all([
      db.select().from(leads)
        .where(eq(leads.tenantId, context.tenantId))
        .orderBy(desc(leads.createdAt)).limit(50),
      db.select().from(responseDrafts)
        .where(eq(responseDrafts.tenantId, context.tenantId)),
      db.select().from(auditEvents)
        .where(eq(auditEvents.tenantId, context.tenantId))
        .orderBy(desc(auditEvents.createdAt)).limit(200),
    ]);
    const result: Lead[] = rows.map((row) => {
      const draft = drafts.find((candidate) => candidate.leadId === row.id);
      return {
        id: row.id,
        draftId: draft?.id,
        name: row.name,
        email: row.email,
        phone: row.phone ?? undefined,
        vehicle: row.vehicle,
        year: row.year ?? undefined,
        make: row.make ?? undefined,
        model: row.model ?? undefined,
        mileage: row.mileage ?? undefined,
        service: row.service,
        symptoms: row.symptoms,
        urgency: row.urgency,
        source: row.source,
        status: row.status as Lead["status"],
        authority: row.authority,
        summary: row.summary,
        draft: draft?.body ?? "",
        draftState: draft?.state,
        nextAction: row.nextAction,
        nextFollowUp: row.nextFollowUp,
        createdAt: row.createdAt,
        activities: audits
          .filter((audit) => audit.leadId === row.id)
          .map((audit) => ({
            label: audit.action,
            at: audit.createdAt,
            kind: audit.authority === "red" ? "alert" as const : "normal" as const,
          }))
          .reverse(),
      };
    });
    return Response.json({
      leads: result,
      persisted: true,
      workspace: { name: context.tenantName, role: context.role },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    authenticatedEmail(request);
    const db = await getDb();
    const context = await resolveRequestContext(request, db);
    requireRole(context, ["owner", "manager", "advisor"]);
    const payload = await request.json() as InquiryInput;
    if (!payload.name?.trim() || !payload.email?.trim() || !payload.message?.trim()) {
      return Response.json(
        { error: "invalid_inquiry", message: "name, email, and message are required" },
        { status: 400 },
      );
    }

    const lead = processInquiry(payload);
    const now = lead.createdAt;
    const draftId = id("draft");
    const correlationId = id("intake");
    await db.batch([
      db.insert(leads).values({
        id: lead.id,
        tenantId: context.tenantId,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        vehicle: lead.vehicle,
        year: lead.year,
        make: lead.make,
        model: lead.model,
        mileage: lead.mileage,
        service: lead.service,
        symptoms: lead.symptoms,
        urgency: lead.urgency,
        source: lead.source,
        status: lead.status,
        authority: lead.authority,
        summary: lead.summary,
        nextAction: lead.nextAction,
        nextFollowUp: lead.nextFollowUp,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(messages).values({
        id: id("msg"), tenantId: context.tenantId, leadId: lead.id,
        direction: "inbound", channel: lead.source, body: lead.symptoms,
        sendState: "received", createdAt: now,
      }),
      db.insert(responseDrafts).values({
        id: draftId, tenantId: context.tenantId, leadId: lead.id,
        body: lead.draft, authority: lead.authority,
        state: lead.authority === "red" ? "blocked" : "pending",
        createdAt: now, updatedAt: now,
      }),
      db.insert(followUps).values({
        id: id("followup"), tenantId: context.tenantId, leadId: lead.id,
        dueAt: lead.nextFollowUp, state: "scheduled", createdAt: now,
      }),
      db.insert(auditEvents).values({
        id: id("audit"), tenantId: context.tenantId, leadId: lead.id,
        actorType: "user", actorId: context.actorId, actorRole: context.role,
        action: "inquiry_received", authority: lead.authority,
        targetType: "lead", targetId: lead.id, correlationId,
        detailsJson: JSON.stringify({ source: lead.source }), createdAt: now,
      }),
      db.insert(auditEvents).values({
        id: id("audit"), tenantId: context.tenantId, leadId: lead.id,
        actorType: "ai", actorId: "deterministic-lead-operator-v1",
        action: "lead_classified_and_draft_created", authority: lead.authority,
        targetType: "draft", targetId: draftId, correlationId,
        detailsJson: JSON.stringify({ draftState: lead.authority === "red" ? "blocked" : "pending" }),
        createdAt: now,
      }),
    ]);

    return Response.json(
      { lead: { ...lead, draftId, draftState: lead.authority === "red" ? "blocked" : "pending" }, persisted: true },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
