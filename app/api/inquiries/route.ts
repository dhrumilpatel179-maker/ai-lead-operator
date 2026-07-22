import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditEvents, followUps, leads, messages, responseDrafts } from "../../../db/schema";
import { matchExistingLead, processInquiry, type InquiryInput, type Lead } from "../../../lib/workflow";
import { authenticatedEmail, errorResponse, requireRole, resolveRequestContext } from "../../../lib/security";

type LeadRow = typeof leads.$inferSelect;
type DraftRow = typeof responseDrafts.$inferSelect;
type AuditRow = typeof auditEvents.$inferSelect;

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function escalationReasons(row: LeadRow): string[] {
  try {
    const parsed: unknown = JSON.parse(row.escalationReasonsJson);
    if (Array.isArray(parsed) && parsed.every((value) => typeof value === "string") && (parsed.length > 0 || row.authority === "green")) return parsed;
  } catch {
    // Legacy or malformed rows fail visibly into a conservative human-review reason.
  }
  return row.authority === "green" ? [] : ["Human review required by authority policy."];
}

function toLead(row: LeadRow, draft: DraftRow | undefined, audits: AuditRow[]): Lead {
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
    escalationReasons: escalationReasons(row),
    immediateEscalation: row.immediateEscalation,
    disposition: row.disposition,
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
        kind: audit.authority === "green" ? "normal" as const : "alert" as const,
      }))
      .reverse(),
  };
}

export async function GET(request: Request) {
  try {
    authenticatedEmail(request);
    const db = await getDb();
    const context = await resolveRequestContext(request, db);
    const [rows, drafts, audits] = await Promise.all([
      db.select().from(leads)
        .where(eq(leads.tenantId, context.tenantId))
        .orderBy(desc(leads.createdAt)),
      db.select().from(responseDrafts)
        .where(eq(responseDrafts.tenantId, context.tenantId)),
      db.select().from(auditEvents)
        .where(eq(auditEvents.tenantId, context.tenantId))
        .orderBy(desc(auditEvents.createdAt)).limit(500),
    ]);
    const result = rows.map((row) =>
      toLead(row, drafts.find((candidate) => candidate.leadId === row.id), audits),
    );
    return Response.json({
      leads: result,
      totalLeads: result.length,
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
    const hasAttachment = Boolean(payload.attachments?.length);
    if (!payload.name?.trim() || !payload.email?.trim() || (!payload.message?.trim() && !hasAttachment)) {
      return Response.json(
        { error: "invalid_inquiry", message: "name, email, and either a message or attachment are required" },
        { status: 400 },
      );
    }

    const recentRows = await db.select().from(leads)
      .where(eq(leads.tenantId, context.tenantId))
      .orderBy(desc(leads.createdAt)).limit(100);
    const duplicate = matchExistingLead(payload, recentRows);
    if (duplicate) {
      const existing = recentRows.find((row) => row.id === duplicate.leadId);
      if (!existing) throw new Error("Duplicate resolution failed closed");
      const now = new Date().toISOString();
      const correlationId = id("linked_inquiry");
      await db.batch([
        db.insert(messages).values({
          id: id("msg"), tenantId: context.tenantId, leadId: existing.id,
          direction: "inbound", channel: payload.source ?? "Website form",
          body: payload.message.trim() || "[Attachment-only inquiry]",
          sendState: "received", createdAt: now,
        }),
        db.insert(auditEvents).values({
          id: id("audit"), tenantId: context.tenantId, leadId: existing.id,
          actorType: "system", actorId: "deterministic-lead-operator-v1",
          action: "inquiry_linked_to_existing_lead", authority: existing.authority,
          targetType: "lead", targetId: existing.id, correlationId,
          detailsJson: JSON.stringify({ reason: duplicate.reason, source: payload.source ?? "Website form" }),
          createdAt: now,
        }),
      ]);
      const [drafts, audits] = await Promise.all([
        db.select().from(responseDrafts).where(eq(responseDrafts.tenantId, context.tenantId)),
        db.select().from(auditEvents).where(eq(auditEvents.tenantId, context.tenantId)).orderBy(desc(auditEvents.createdAt)).limit(500),
      ]);
      return Response.json({
        lead: toLead(existing, drafts.find((candidate) => candidate.leadId === existing.id), audits),
        duplicate: { linked: true, reason: duplicate.reason },
        persisted: true,
      });
    }

    const lead = processInquiry(payload);
    const now = lead.createdAt;
    const draftId = id("draft");
    const correlationId = id("intake");
    const leadInsert = db.insert(leads).values({
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
      escalationReasonsJson: JSON.stringify(lead.escalationReasons),
      immediateEscalation: lead.immediateEscalation,
      disposition: lead.disposition,
      summary: lead.summary,
      nextAction: lead.nextAction,
      nextFollowUp: lead.nextFollowUp,
      createdAt: now,
      updatedAt: now,
    });
    const messageInsert = db.insert(messages).values({
      id: id("msg"), tenantId: context.tenantId, leadId: lead.id,
      direction: "inbound", channel: lead.source,
      body: lead.symptoms || "[Attachment-only inquiry]",
      sendState: "received", createdAt: now,
    });
    const receivedAudit = db.insert(auditEvents).values({
      id: id("audit"), tenantId: context.tenantId, leadId: lead.id,
      actorType: "user", actorId: context.actorId, actorRole: context.role,
      action: "inquiry_received", authority: lead.authority,
      targetType: "lead", targetId: lead.id, correlationId,
      detailsJson: JSON.stringify({ source: lead.source, attachmentCount: payload.attachments?.length ?? 0 }),
      createdAt: now,
    });
    const classifiedAudit = db.insert(auditEvents).values({
      id: id("audit"), tenantId: context.tenantId, leadId: lead.id,
      actorType: "ai", actorId: "deterministic-lead-operator-v1",
      action: lead.disposition === "no_action" ? "lead_classified_no_action" : "lead_classified_and_draft_created",
      authority: lead.authority,
      targetType: lead.disposition === "no_action" ? "lead" : "draft",
      targetId: lead.disposition === "no_action" ? lead.id : draftId,
      correlationId,
      detailsJson: JSON.stringify({
        draftState: lead.disposition === "no_action" ? "not_created" : lead.authority === "red" ? "blocked" : "pending",
        escalationReasons: lead.escalationReasons,
        disposition: lead.disposition,
        immediateEscalation: lead.immediateEscalation,
      }),
      createdAt: now,
    });

    if (lead.disposition === "no_action") {
      await db.batch([leadInsert, messageInsert, receivedAudit, classifiedAudit]);
      return Response.json({ lead, persisted: true, noAction: true }, { status: 201 });
    }

    await db.batch([
      leadInsert,
      messageInsert,
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
      receivedAudit,
      classifiedAudit,
    ]);

    return Response.json(
      { lead: { ...lead, draftId, draftState: lead.authority === "red" ? "blocked" : "pending" }, persisted: true },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
