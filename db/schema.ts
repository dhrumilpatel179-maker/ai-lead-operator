import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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
  escalationReasonsJson: text("escalation_reasons_json").notNull().default("[]"),
  immediateEscalation: integer("immediate_escalation", { mode: "boolean" }).notNull().default(false),
  disposition: text("disposition", { enum: ["reply", "no_action", "language_review", "attachment_review"] }).notNull().default("reply"),
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
  uniqueIndex("approvals_outbox_chain_idx").on(
    table.tenantId,
    table.leadId,
    table.draftId,
    table.id,
  ),
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

export const providerConnectionStatuses = [
  "pending",
  "active",
  "reconnect_required",
  "revoked",
  "error",
] as const;

export const providerConnections = sqliteTable("provider_connections", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  externalAccountId: text("external_account_id").notNull(),
  status: text("status", { enum: providerConnectionStatuses }).notNull().default("pending"),
  grantedScopesJson: text("granted_scopes_json").notNull().default("[]"),
  credentialEnvelopeCiphertext: text("credential_envelope_ciphertext"),
  credentialEnvelopeNonce: text("credential_envelope_nonce"),
  credentialEnvelopeAuthTag: text("credential_envelope_auth_tag"),
  credentialKeyVersion: text("credential_key_version"),
  credentialSchemaVersion: integer("credential_schema_version"),
  gmailWatchExpiresAt: text("gmail_watch_expires_at"),
  gmailHistoryId: text("gmail_history_id"),
  reconnectRequiredAt: text("reconnect_required_at"),
  revokedAt: text("revoked_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("provider_connections_tenant_account_idx").on(
    table.tenantId,
    table.provider,
    table.externalAccountId,
  ),
  uniqueIndex("provider_connections_tenant_id_idx").on(table.tenantId, table.id),
  uniqueIndex("provider_connections_tenant_id_provider_idx").on(
    table.tenantId,
    table.id,
    table.provider,
  ),
  index("provider_connections_tenant_status_idx").on(table.tenantId, table.status),
  check(
    "provider_connections_status_check",
    sql`${table.status} in ('pending','active','reconnect_required','revoked','error')`,
  ),
  check(
    "provider_connections_scopes_json_check",
    sql`json_valid(${table.grantedScopesJson}) and json_type(${table.grantedScopesJson}) = 'array'`,
  ),
  check(
    "provider_connections_envelope_check",
    sql`(
      ${table.status} in ('pending','revoked')
      and ${table.credentialEnvelopeCiphertext} is null
      and ${table.credentialEnvelopeNonce} is null
      and ${table.credentialEnvelopeAuthTag} is null
      and ${table.credentialKeyVersion} is null
      and ${table.credentialSchemaVersion} is null
    ) or (
      ${table.status} in ('active','reconnect_required','error')
      and ${table.credentialEnvelopeCiphertext} is not null
      and ${table.credentialEnvelopeNonce} is not null
      and ${table.credentialEnvelopeAuthTag} is not null
      and ${table.credentialKeyVersion} is not null
      and ${table.credentialSchemaVersion} is not null
      and length(${table.credentialEnvelopeCiphertext}) > 0
      and length(${table.credentialEnvelopeNonce}) > 0
      and length(${table.credentialEnvelopeAuthTag}) > 0
      and length(${table.credentialKeyVersion}) > 0
      and ${table.credentialSchemaVersion} > 0
    ) or (
      ${table.status} in ('reconnect_required','error')
      and ${table.credentialEnvelopeCiphertext} is null
      and ${table.credentialEnvelopeNonce} is null
      and ${table.credentialEnvelopeAuthTag} is null
      and ${table.credentialKeyVersion} is null
      and ${table.credentialSchemaVersion} is null
    )`,
  ),
  check(
    "provider_connections_lifecycle_timestamp_check",
    sql`(
      ${table.status} = 'pending'
      and ${table.reconnectRequiredAt} is null
      and ${table.revokedAt} is null
    ) or (
      ${table.status} = 'reconnect_required'
      and ${table.reconnectRequiredAt} is not null
      and ${table.revokedAt} is null
    ) or (
      ${table.status} = 'revoked'
      and ${table.revokedAt} is not null
    ) or (
      ${table.status} in ('active','error')
      and ${table.revokedAt} is null
    )`,
  ),
]);

export const inboundProviderEventStates = [
  "received",
  "processing",
  "processed",
  "failed",
  "rejected",
] as const;

export const inboundProviderEvents = sqliteTable("inbound_provider_events", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  connectionId: text("connection_id").notNull(),
  provider: text("provider").notNull(),
  externalEventId: text("external_event_id").notNull(),
  processingState: text("processing_state", { enum: inboundProviderEventStates }).notNull().default("received"),
  payloadHash: text("payload_hash").notNull(),
  nonSensitiveMetadataJson: text("non_sensitive_metadata_json").notNull().default("{}"),
  attachmentPresent: integer("attachment_present", { mode: "boolean" }).notNull().default(false),
  attachmentCount: integer("attachment_count").notNull().default(0),
  receivedAt: text("received_at").notNull(),
  processedAt: text("processed_at"),
  deletionDueAt: text("deletion_due_at").notNull(),
  failureClassification: text("failure_classification"),
  rejectionClassification: text("rejection_classification"),
}, (table) => [
  foreignKey({
    columns: [table.tenantId, table.connectionId, table.provider],
    foreignColumns: [
      providerConnections.tenantId,
      providerConnections.id,
      providerConnections.provider,
    ],
    name: "inbound_events_connection_tenant_provider_fk",
  }).onDelete("cascade"),
  uniqueIndex("inbound_events_connection_external_idx").on(
    table.connectionId,
    table.externalEventId,
  ),
  index("inbound_events_tenant_state_idx").on(table.tenantId, table.processingState),
  index("inbound_events_tenant_deletion_idx").on(table.tenantId, table.deletionDueAt),
  check(
    "inbound_events_state_check",
    sql`${table.processingState} in ('received','processing','processed','failed','rejected')`,
  ),
  check("inbound_events_payload_hash_check", sql`length(${table.payloadHash}) = 64 and ${table.payloadHash} not glob '*[^0-9a-f]*'`),
  check(
    "inbound_events_metadata_json_check",
    sql`json_valid(${table.nonSensitiveMetadataJson})
      and json_type(${table.nonSensitiveMetadataJson}) = 'object'
      and length(${table.nonSensitiveMetadataJson}) <= 2048`,
  ),
  check("inbound_events_attachment_count_check", sql`${table.attachmentCount} >= 0`),
  check(
    "inbound_events_attachment_consistency_check",
    sql`(${table.attachmentPresent} = 1 and ${table.attachmentCount} > 0) or (${table.attachmentPresent} = 0 and ${table.attachmentCount} = 0)`,
  ),
  check("inbound_events_retention_check", sql`${table.deletionDueAt} >= ${table.receivedAt}`),
]);

export const consentStatuses = ["reply_only", "granted", "revoked", "suppressed"] as const;

export const consentRecords = sqliteTable("consent_records", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  normalizedCustomerIdentity: text("normalized_customer_identity").notNull(),
  channel: text("channel").notNull(),
  status: text("status", { enum: consentStatuses }).notNull().default("reply_only"),
  source: text("source").notNull(),
  evidenceMetadataJson: text("evidence_metadata_json").notNull().default("{}"),
  recordedAt: text("recorded_at").notNull(),
  revokedAt: text("revoked_at"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("consent_tenant_identity_channel_idx").on(
    table.tenantId,
    table.normalizedCustomerIdentity,
    table.channel,
    table.recordedAt,
  ),
  index("consent_tenant_status_idx").on(table.tenantId, table.status),
  check(
    "consent_status_check",
    sql`${table.status} in ('reply_only','granted','revoked','suppressed')`,
  ),
  check(
    "consent_evidence_json_check",
    sql`json_valid(${table.evidenceMetadataJson})
      and json_type(${table.evidenceMetadataJson}) = 'object'
      and length(${table.evidenceMetadataJson}) <= 4096`,
  ),
  check(
    "consent_revoked_timestamp_check",
    sql`${table.status} <> 'revoked' or ${table.revokedAt} is not null`,
  ),
]);

export const providerSendOutboxStates = [
  "queued",
  "claimed",
  "sending",
  "sent",
  "failed",
  "needs_reconciliation",
  "cancelled",
] as const;

export const providerSendOutbox = sqliteTable("provider_send_outbox", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  connectionId: text("connection_id").notNull(),
  leadId: text("lead_id").notNull(),
  draftId: text("draft_id").notNull(),
  approvalId: text("approval_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  approvedBodyHash: text("approved_body_hash").notNull(),
  state: text("state", { enum: providerSendOutboxStates }).notNull().default("queued"),
  providerMessageId: text("provider_message_id"),
  attemptCount: integer("attempt_count").notNull().default(0),
  claimToken: text("claim_token"),
  claimedAt: text("claimed_at"),
  claimExpiresAt: text("claim_expires_at"),
  nextAttemptAt: text("next_attempt_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletionDueAt: text("deletion_due_at").notNull(),
}, (table) => [
  foreignKey({
    columns: [table.tenantId, table.connectionId],
    foreignColumns: [providerConnections.tenantId, providerConnections.id],
    name: "provider_outbox_connection_tenant_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.tenantId, table.leadId, table.draftId, table.approvalId],
    foreignColumns: [
      approvalEvents.tenantId,
      approvalEvents.leadId,
      approvalEvents.draftId,
      approvalEvents.id,
    ],
    name: "provider_outbox_approval_chain_fk",
  }).onDelete("restrict"),
  uniqueIndex("provider_outbox_tenant_idempotency_idx").on(table.tenantId, table.idempotencyKey),
  uniqueIndex("provider_outbox_tenant_approval_idx").on(table.tenantId, table.approvalId),
  index("provider_outbox_tenant_state_attempt_idx").on(
    table.tenantId,
    table.state,
    table.nextAttemptAt,
  ),
  index("provider_outbox_tenant_claim_expiry_idx").on(
    table.tenantId,
    table.state,
    table.claimExpiresAt,
  ),
  check(
    "provider_outbox_state_check",
    sql`${table.state} in ('queued','claimed','sending','sent','failed','needs_reconciliation','cancelled')`,
  ),
  check("provider_outbox_hash_check", sql`length(${table.approvedBodyHash}) = 64 and ${table.approvedBodyHash} not glob '*[^0-9a-f]*'`),
  check("provider_outbox_attempt_count_check", sql`${table.attemptCount} >= 0`),
  check("provider_outbox_retention_check", sql`${table.deletionDueAt} >= ${table.createdAt}`),
  check(
    "provider_outbox_claim_fields_check",
    sql`(
      ${table.state} in ('claimed','sending')
      and ${table.claimToken} is not null
      and ${table.claimedAt} is not null
      and ${table.claimExpiresAt} is not null
      and ${table.claimExpiresAt} > ${table.claimedAt}
    ) or (
      ${table.state} not in ('claimed','sending')
      and ${table.claimToken} is null
      and ${table.claimedAt} is null
      and ${table.claimExpiresAt} is null
    )`,
  ),
]);
