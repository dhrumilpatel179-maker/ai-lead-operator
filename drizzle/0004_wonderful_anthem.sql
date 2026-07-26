CREATE TABLE `consent_records` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`normalized_customer_identity` text NOT NULL,
	`channel` text NOT NULL,
	`status` text DEFAULT 'reply_only' NOT NULL,
	`source` text NOT NULL,
	`evidence_metadata_json` text DEFAULT '{}' NOT NULL,
	`recorded_at` text NOT NULL,
	`revoked_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "consent_status_check" CHECK("consent_records"."status" in ('reply_only','granted','revoked','suppressed')),
	CONSTRAINT "consent_evidence_json_check" CHECK(json_valid("consent_records"."evidence_metadata_json")
      and json_type("consent_records"."evidence_metadata_json") = 'object'
      and length("consent_records"."evidence_metadata_json") <= 4096),
	CONSTRAINT "consent_revoked_timestamp_check" CHECK("consent_records"."status" <> 'revoked' or "consent_records"."revoked_at" is not null)
);
--> statement-breakpoint
CREATE INDEX `consent_tenant_identity_channel_idx` ON `consent_records` (`tenant_id`,`normalized_customer_identity`,`channel`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `consent_tenant_status_idx` ON `consent_records` (`tenant_id`,`status`);--> statement-breakpoint
CREATE TABLE `inbound_provider_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_event_id` text NOT NULL,
	`processing_state` text DEFAULT 'received' NOT NULL,
	`payload_hash` text NOT NULL,
	`non_sensitive_metadata_json` text DEFAULT '{}' NOT NULL,
	`attachment_present` integer DEFAULT false NOT NULL,
	`attachment_count` integer DEFAULT 0 NOT NULL,
	`received_at` text NOT NULL,
	`processed_at` text,
	`deletion_due_at` text NOT NULL,
	`failure_classification` text,
	`rejection_classification` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`,`connection_id`,`provider`) REFERENCES `provider_connections`(`tenant_id`,`id`,`provider`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "inbound_events_state_check" CHECK("inbound_provider_events"."processing_state" in ('received','processing','processed','failed','rejected')),
	CONSTRAINT "inbound_events_payload_hash_check" CHECK(length("inbound_provider_events"."payload_hash") = 64 and "inbound_provider_events"."payload_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "inbound_events_metadata_json_check" CHECK(json_valid("inbound_provider_events"."non_sensitive_metadata_json")
      and json_type("inbound_provider_events"."non_sensitive_metadata_json") = 'object'
      and length("inbound_provider_events"."non_sensitive_metadata_json") <= 2048),
	CONSTRAINT "inbound_events_attachment_count_check" CHECK("inbound_provider_events"."attachment_count" >= 0),
	CONSTRAINT "inbound_events_attachment_consistency_check" CHECK(("inbound_provider_events"."attachment_present" = 1 and "inbound_provider_events"."attachment_count" > 0) or ("inbound_provider_events"."attachment_present" = 0 and "inbound_provider_events"."attachment_count" = 0)),
	CONSTRAINT "inbound_events_retention_check" CHECK("inbound_provider_events"."deletion_due_at" >= "inbound_provider_events"."received_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbound_events_connection_external_idx` ON `inbound_provider_events` (`connection_id`,`external_event_id`);--> statement-breakpoint
CREATE INDEX `inbound_events_tenant_state_idx` ON `inbound_provider_events` (`tenant_id`,`processing_state`);--> statement-breakpoint
CREATE INDEX `inbound_events_tenant_deletion_idx` ON `inbound_provider_events` (`tenant_id`,`deletion_due_at`);--> statement-breakpoint
CREATE TABLE `provider_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_account_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`granted_scopes_json` text DEFAULT '[]' NOT NULL,
	`credential_envelope_ciphertext` text NOT NULL,
	`credential_envelope_nonce` text NOT NULL,
	`credential_envelope_auth_tag` text NOT NULL,
	`credential_key_version` text NOT NULL,
	`gmail_watch_expires_at` text,
	`gmail_history_id` text,
	`reconnect_required_at` text,
	`revoked_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "provider_connections_status_check" CHECK("provider_connections"."status" in ('pending','active','reconnect_required','revoked','error')),
	CONSTRAINT "provider_connections_scopes_json_check" CHECK(json_valid("provider_connections"."granted_scopes_json") and json_type("provider_connections"."granted_scopes_json") = 'array'),
	CONSTRAINT "provider_connections_envelope_check" CHECK(length("provider_connections"."credential_envelope_ciphertext") > 0
      and length("provider_connections"."credential_envelope_nonce") > 0
      and length("provider_connections"."credential_envelope_auth_tag") > 0
      and length("provider_connections"."credential_key_version") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_connections_tenant_account_idx` ON `provider_connections` (`tenant_id`,`provider`,`external_account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `provider_connections_tenant_id_idx` ON `provider_connections` (`tenant_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `provider_connections_tenant_id_provider_idx` ON `provider_connections` (`tenant_id`,`id`,`provider`);--> statement-breakpoint
CREATE INDEX `provider_connections_tenant_status_idx` ON `provider_connections` (`tenant_id`,`status`);--> statement-breakpoint
CREATE TABLE `provider_send_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`draft_id` text NOT NULL,
	`approval_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`approved_body_hash` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`provider_message_id` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`claim_token` text,
	`claimed_at` text,
	`claim_expires_at` text,
	`next_attempt_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deletion_due_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`,`connection_id`) REFERENCES `provider_connections`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`lead_id`,`draft_id`,`approval_id`) REFERENCES `approval_events`(`tenant_id`,`lead_id`,`draft_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "provider_outbox_state_check" CHECK("provider_send_outbox"."state" in ('queued','claimed','sending','sent','failed','needs_reconciliation','cancelled')),
	CONSTRAINT "provider_outbox_hash_check" CHECK(length("provider_send_outbox"."approved_body_hash") = 64 and "provider_send_outbox"."approved_body_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "provider_outbox_attempt_count_check" CHECK("provider_send_outbox"."attempt_count" >= 0),
	CONSTRAINT "provider_outbox_retention_check" CHECK("provider_send_outbox"."deletion_due_at" >= "provider_send_outbox"."created_at"),
	CONSTRAINT "provider_outbox_claim_fields_check" CHECK((
      "provider_send_outbox"."state" in ('claimed','sending')
      and "provider_send_outbox"."claim_token" is not null
      and "provider_send_outbox"."claimed_at" is not null
      and "provider_send_outbox"."claim_expires_at" is not null
      and "provider_send_outbox"."claim_expires_at" > "provider_send_outbox"."claimed_at"
    ) or (
      "provider_send_outbox"."state" not in ('claimed','sending')
      and "provider_send_outbox"."claim_token" is null
      and "provider_send_outbox"."claimed_at" is null
      and "provider_send_outbox"."claim_expires_at" is null
    ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_outbox_tenant_idempotency_idx` ON `provider_send_outbox` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `provider_outbox_tenant_approval_idx` ON `provider_send_outbox` (`tenant_id`,`approval_id`);--> statement-breakpoint
CREATE INDEX `provider_outbox_tenant_state_attempt_idx` ON `provider_send_outbox` (`tenant_id`,`state`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `provider_outbox_tenant_claim_expiry_idx` ON `provider_send_outbox` (`tenant_id`,`state`,`claim_expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `approvals_outbox_chain_idx` ON `approval_events` (`tenant_id`,`lead_id`,`draft_id`,`id`);--> statement-breakpoint
CREATE TRIGGER `provider_outbox_chain_insert`
BEFORE INSERT ON `provider_send_outbox`
FOR EACH ROW
WHEN NOT EXISTS (
	SELECT 1
	FROM `provider_connections` AS `connection`
	JOIN `leads` AS `lead`
		ON `lead`.`tenant_id` = NEW.`tenant_id`
		AND `lead`.`id` = NEW.`lead_id`
	JOIN `response_drafts` AS `draft`
		ON `draft`.`tenant_id` = NEW.`tenant_id`
		AND `draft`.`id` = NEW.`draft_id`
		AND `draft`.`lead_id` = NEW.`lead_id`
	JOIN `approval_events` AS `approval`
		ON `approval`.`tenant_id` = NEW.`tenant_id`
		AND `approval`.`id` = NEW.`approval_id`
		AND `approval`.`lead_id` = NEW.`lead_id`
		AND `approval`.`draft_id` = NEW.`draft_id`
	WHERE `connection`.`tenant_id` = NEW.`tenant_id`
		AND `connection`.`id` = NEW.`connection_id`
		AND `connection`.`status` = 'active'
		AND `approval`.`decision` = 'approved'
		AND `approval`.`body_hash` = NEW.`approved_body_hash`
)
BEGIN
	SELECT RAISE(ABORT, 'provider outbox tenant or approval chain mismatch');
END;--> statement-breakpoint
CREATE TRIGGER `provider_outbox_relationships_immutable`
BEFORE UPDATE OF
	`tenant_id`, `connection_id`, `lead_id`, `draft_id`, `approval_id`, `idempotency_key`
ON `provider_send_outbox`
FOR EACH ROW
WHEN NEW.`tenant_id` <> OLD.`tenant_id`
	OR NEW.`connection_id` <> OLD.`connection_id`
	OR NEW.`lead_id` <> OLD.`lead_id`
	OR NEW.`draft_id` <> OLD.`draft_id`
	OR NEW.`approval_id` <> OLD.`approval_id`
	OR NEW.`idempotency_key` <> OLD.`idempotency_key`
BEGIN
	SELECT RAISE(ABORT, 'provider outbox relationship is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `provider_outbox_approved_hash_immutable`
BEFORE UPDATE OF `approved_body_hash` ON `provider_send_outbox`
FOR EACH ROW
WHEN NEW.`approved_body_hash` <> OLD.`approved_body_hash`
BEGIN
	SELECT RAISE(ABORT, 'approved body hash is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `provider_outbox_state_transition`
BEFORE UPDATE OF `state` ON `provider_send_outbox`
FOR EACH ROW
WHEN NOT (
	(OLD.`state` = 'queued' AND NEW.`state` IN ('claimed','cancelled'))
	OR (OLD.`state` = 'claimed' AND NEW.`state` IN ('sending','failed','cancelled'))
	OR (
		OLD.`state` = 'claimed'
		AND NEW.`state` = 'queued'
		AND OLD.`claim_expires_at` <= NEW.`updated_at`
	)
	OR (
		OLD.`state` = 'claimed'
		AND NEW.`state` = 'claimed'
		AND OLD.`claim_expires_at` <= NEW.`claimed_at`
		AND NEW.`claim_token` <> OLD.`claim_token`
	)
	OR (OLD.`state` = 'sending' AND NEW.`state` IN ('sent','failed','needs_reconciliation'))
	OR (OLD.`state` = 'failed' AND NEW.`state` IN ('queued','cancelled'))
	OR (OLD.`state` = 'needs_reconciliation' AND NEW.`state` IN ('sent','failed','cancelled'))
)
BEGIN
	SELECT RAISE(ABORT, 'illegal provider outbox state transition');
END;--> statement-breakpoint
CREATE TRIGGER `provider_outbox_claim_ownership`
BEFORE UPDATE OF `claim_token`, `claimed_at`, `claim_expires_at`
ON `provider_send_outbox`
FOR EACH ROW
WHEN (
	OLD.`state` = 'sending'
	AND NEW.`state` = 'sending'
	AND (
		NEW.`claim_token` IS NOT OLD.`claim_token`
		OR NEW.`claimed_at` IS NOT OLD.`claimed_at`
		OR NEW.`claim_expires_at` IS NOT OLD.`claim_expires_at`
	)
) OR (
	OLD.`state` = 'claimed'
	AND NEW.`state` = 'claimed'
	AND NOT (
		OLD.`claim_expires_at` <= NEW.`claimed_at`
		AND NEW.`claim_token` <> OLD.`claim_token`
	)
)
BEGIN
	SELECT RAISE(ABORT, 'provider outbox claim is already held');
END;
