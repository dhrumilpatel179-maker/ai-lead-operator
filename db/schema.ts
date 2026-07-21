import { index, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});

export const tenantMemberships = sqliteTable("tenant_memberships", {
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userEmail: text("user_email").notNull(),
  role: text("role", { enum: ["owner", "manager", "advisor", "viewer"] }).notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.tenantId, table.userEmail] }), index("memberships_email_idx").on(table.userEmail)]);

export const leads = sqliteTable("leads", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  vehicle: text("vehicle").notNull(),
  year: text("vehicle_year"),
  make: text("vehicle_make"),
  model: text("vehicle_model"),
  mileage: text("vehicle_mileage"),
  service: text("service").notNull(),
  symptoms: text("symptoms").notNull(),
  urgency: text("urgency", { enum: ["routine", "soon", "urgent"] }).notNull(),
  source: text("source").notNull(),
  status: text("status").notNull(),
  authority: text("authority", { enum: ["green", "yellow", "red"] }).notNull(),
  summary: text("summary").notNull(),
  nextAction: text("next_action").notNull(),
  nextFollowUp: text("next_follow_up").notNull(),
  assignedHuman: text("assigned_human"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("leads_tenant_status_idx").on(table.tenantId, table.status), index("leads_tenant_followup_idx").on(table.tenantId, table.nextFollowUp)]);

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
  channel: text("channel").notNull(),
  body: text("body").notNull(),
  sentAt: text("sent_at"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("messages_tenant_lead_idx").on(table.tenantId, table.leadId)]);

export const responseDrafts = sqliteTable("response_drafts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  authority: text("authority", { enum: ["green", "yellow", "red"] }).notNull(),
  state: text("state", { enum: ["pending", "approved", "rejected", "sent", "blocked"] }).notNull(),
  approvedBy: text("approved_by"),
  approvedAt: text("approved_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("drafts_tenant_state_idx").on(table.tenantId, table.state), uniqueIndex("drafts_lead_active_idx").on(table.tenantId, table.leadId, table.createdAt)]);

export const followUps = sqliteTable("follow_ups", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  dueAt: text("due_at").notNull(),
  state: text("state", { enum: ["scheduled", "completed", "cancelled"] }).notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("followups_tenant_due_idx").on(table.tenantId, table.state, table.dueAt)]);

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
  actorType: text("actor_type", { enum: ["ai", "user", "system", "integration"] }).notNull(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  authority: text("authority", { enum: ["green", "yellow", "red"] }),
  detailsJson: text("details_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("audit_tenant_created_idx").on(table.tenantId, table.createdAt), index("audit_tenant_lead_idx").on(table.tenantId, table.leadId)]);

export const businessSettings = sqliteTable("business_settings", {
  tenantId: text("tenant_id").primaryKey().references(() => tenants.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("America/Chicago"),
  businessHoursJson: text("business_hours_json").notNull().default("{}"),
  servicesJson: text("services_json").notNull().default("[]"),
  prohibitedClaimsJson: text("prohibited_claims_json").notNull().default("[]"),
  authorityRulesJson: text("authority_rules_json").notNull().default("{}"),
  updatedAt: text("updated_at").notNull(),
});
