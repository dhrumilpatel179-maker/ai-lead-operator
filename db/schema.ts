import { index, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const roles = ["owner", "manager", "advisor", "viewer"] as const;

export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});

export const tenantMemberships = sqliteTable("tenant_memberships", {
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userEmail: text("user_email").notNull(),
  role: text("role", { enum: roles }).notNull(),
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
  sendState: text("send_state", { enum: ["received", "pending", "sent", "failed", "blocked"] }).notNull().default("received"),
  idempotencyKey: text("idempotency_key"),
  sentAt: text("sent_at"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("messages_tenant_lead_idx").on(table.tenantId, table.leadId),
  uniqueIndex("messages_tenant_idempotency_idx").on(table.tenantId, table.idempotencyKey),
]);

export const responseDrafts = sqliteTable("response_drafts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  authority: text("authority", { enum: ["green", "yellow", "red"] }).notNull(),
  state: text("state", { enum: ["pending", "approved", "rejected", "sent", "blocked"] }).notNull(),
  approvedBy: text("approved_by"),
  approvedAt: text("approved_at"),
  transitionToken: text("transition_token"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("drafts_tenant_state_idx").on(table.tenantId, table.state), uniqueIndex("drafts_lead_active_idx").on(table.tenantId, table.leadId, table.createdAt)]);

export const followUps = sqliteTable("follow_ups", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  dueAt: text("due_at").notNull(),
  state: text("state", { enum: ["scheduled", "completed", "cancelled"] }).notNull(),
  sourceSendOperationId: text("source_send_operation_id"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("followups_tenant_due_idx").on(table.tenantId, table.state, table.dueAt),
  uniqueIndex("followups_send_operation_idx").on(table.tenantId, table.sourceSendOperationId),
]);

export const approvalEvents = sqliteTable("approval_events", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  draftId: text("draft_id").notNull().references(() => responseDrafts.id, { onDelete: "cascade" }),
  decision: text("decision", { enum: ["approved", "rejected", "blocked"] }).notNull(),
  actorId: text("actor_id").notNull(),
  actorRole: text("actor_role", { enum: roles }).notNull(),
  authority: text("authority", { enum: ["green", "yellow", "red"] }).notNull(),
  bodyHash: text("body_hash").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("approvals_tenant_draft_idx").on(table.tenantId, table.draftId, table.createdAt),
  uniqueIndex("approvals_tenant_idempotency_idx").on(table.tenantId, table.idempotencyKey),
]);

export const sendOperations = sqliteTable("send_operations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  draftId: text("draft_id").notNull().references(() => responseDrafts.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  payloadHash: text("payload_hash").notNull(),
  state: text("state", { enum: ["sent", "failed", "blocked"] }).notNull(),
  transport: text("transport", { enum: ["simulation"] }).notNull().default("simulation"),
  providerMessageId: text("provider_message_id"),
  failureCode: text("failure_code"),
  createdAt: text("created_at").notNull(),
  sentAt: text("sent_at"),
}, (table) => [
  uniqueIndex("send_operations_tenant_idempotency_idx").on(table.tenantId, table.idempotencyKey),
  uniqueIndex("send_operations_tenant_draft_idx").on(table.tenantId, table.draftId),
]);

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
  actorType: text("actor_type", { enum: ["ai", "user", "system", "integration"] }).notNull(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  authority: text("authority", { enum: ["green", "yellow", "red"] }),
  actorRole: text("actor_role", { enum: roles }),
  targetType: text("target_type").notNull().default("system"),
  targetId: text("target_id"),
  correlationId: text("correlation_id").notNull(),
  detailsJson: text("details_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("audit_tenant_created_idx").on(table.tenantId, table.createdAt),
  index("audit_tenant_lead_idx").on(table.tenantId, table.leadId),
  uniqueIndex("audit_tenant_correlation_action_idx").on(table.tenantId, table.correlationId, table.action),
]);

export const businessSettings = sqliteTable("business_settings", {
  tenantId: text("tenant_id").primaryKey().references(() => tenants.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("America/Chicago"),
  businessHoursJson: text("business_hours_json").notNull().default("{}"),
  servicesJson: text("services_json").notNull().default("[]"),
  prohibitedClaimsJson: text("prohibited_claims_json").notNull().default("[]"),
  authorityRulesJson: text("authority_rules_json").notNull().default("{}"),
  updatedAt: text("updated_at").notNull(),
});
