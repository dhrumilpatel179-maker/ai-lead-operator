import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditEvents, followUps, leads, messages, responseDrafts, tenants } from "../../../db/schema";
import { processInquiry, type InquiryInput, type Lead } from "../../../lib/workflow";
import { tenantContext } from "../../../lib/tenant-context";

function id(prefix: string) { return `${prefix}_${crypto.randomUUID()}`; }

export async function GET(request: Request) {
  const context = tenantContext(request);
  try {
    const db = await getDb();
    const rows = await db.select().from(leads).where(eq(leads.tenantId, context.tenantId)).orderBy(desc(leads.createdAt)).limit(50);
    const drafts = await db.select().from(responseDrafts).where(eq(responseDrafts.tenantId, context.tenantId));
    const audits = await db.select().from(auditEvents).where(eq(auditEvents.tenantId, context.tenantId)).orderBy(desc(auditEvents.createdAt)).limit(200);
    const result: Lead[] = rows.map((row) => ({
      id: row.id, name: row.name, email: row.email, phone: row.phone ?? undefined, vehicle: row.vehicle,
      year: row.year ?? undefined, make: row.make ?? undefined, model: row.model ?? undefined, mileage: row.mileage ?? undefined,
      service: row.service, symptoms: row.symptoms, urgency: row.urgency, source: row.source, status: row.status as Lead["status"],
      authority: row.authority, summary: row.summary, draft: drafts.find((draft) => draft.leadId === row.id)?.body ?? "",
      nextAction: row.nextAction, nextFollowUp: row.nextFollowUp, createdAt: row.createdAt,
      activities: audits.filter((audit) => audit.leadId === row.id).map((audit) => ({ label: audit.action, at: audit.createdAt, kind: audit.authority === "red" ? "alert" as const : "normal" as const })).reverse(),
    }));
    return Response.json({ leads: result, persisted: true });
  } catch {
    return Response.json({ leads: [], persisted: false }, { status: 200 });
  }
}

export async function POST(request: Request) {
  const context = tenantContext(request);
  const payload = await request.json() as InquiryInput;
  if (!payload.name?.trim() || !payload.email?.trim() || !payload.message?.trim()) return Response.json({ error: "name, email, and message are required" }, { status: 400 });
  const lead = processInquiry(payload);
  try {
    const db = await getDb();
    const now = lead.createdAt;
    await db.insert(tenants).values({ id: context.tenantId, name: "Northstar Auto Care", createdAt: now }).onConflictDoNothing();
    await db.insert(leads).values({
      id: lead.id, tenantId: context.tenantId, name: lead.name, email: lead.email, phone: lead.phone,
      vehicle: lead.vehicle, year: lead.year, make: lead.make, model: lead.model, mileage: lead.mileage,
      service: lead.service, symptoms: lead.symptoms, urgency: lead.urgency, source: lead.source,
      status: lead.status, authority: lead.authority, summary: lead.summary, nextAction: lead.nextAction,
      nextFollowUp: lead.nextFollowUp, createdAt: now, updatedAt: now,
    });
    await db.batch([
      db.insert(messages).values({ id: id("msg"), tenantId: context.tenantId, leadId: lead.id, direction: "inbound", channel: lead.source, body: lead.symptoms, createdAt: now }),
      db.insert(responseDrafts).values({ id: id("draft"), tenantId: context.tenantId, leadId: lead.id, body: lead.draft, authority: lead.authority, state: lead.authority === "red" ? "blocked" : "pending", createdAt: now, updatedAt: now }),
      db.insert(followUps).values({ id: id("followup"), tenantId: context.tenantId, leadId: lead.id, dueAt: lead.nextFollowUp, state: "scheduled", createdAt: now }),
      db.insert(auditEvents).values({ id: id("audit"), tenantId: context.tenantId, leadId: lead.id, actorType: "integration", actorId: lead.source, action: `Inquiry received via ${lead.source}`, authority: lead.authority, createdAt: now }),
      db.insert(auditEvents).values({ id: id("audit"), tenantId: context.tenantId, leadId: lead.id, actorType: "ai", actorId: "lead-operator-v1", action: `AI extracted details and created a ${lead.authority} draft`, authority: lead.authority, createdAt: now }),
    ]);
    return Response.json({ lead, persisted: true }, { status: 201 });
  } catch {
    return Response.json({ lead, persisted: false }, { status: 201 });
  }
}
