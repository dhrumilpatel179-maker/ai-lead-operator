CREATE TABLE `approval_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`draft_id` text NOT NULL,
	`decision` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_role` text NOT NULL,
	`authority` text NOT NULL,
	`body_hash` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_id`) REFERENCES `response_drafts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `approvals_tenant_draft_idx` ON `approval_events` (`tenant_id`,`draft_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `approvals_tenant_idempotency_idx` ON `approval_events` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `send_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`draft_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`state` text NOT NULL,
	`transport` text DEFAULT 'simulation' NOT NULL,
	`provider_message_id` text,
	`failure_code` text,
	`created_at` text NOT NULL,
	`sent_at` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_id`) REFERENCES `response_drafts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `send_operations_tenant_idempotency_idx` ON `send_operations` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `send_operations_tenant_draft_idx` ON `send_operations` (`tenant_id`,`draft_id`);--> statement-breakpoint
CREATE TABLE `__new_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`lead_id` text,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`authority` text,
	`actor_role` text,
	`target_type` text DEFAULT 'system' NOT NULL,
	`target_id` text,
	`correlation_id` text NOT NULL,
	`details_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_audit_events` (
	`id`, `tenant_id`, `lead_id`, `actor_type`, `actor_id`, `action`, `authority`,
	`actor_role`, `target_type`, `target_id`, `correlation_id`, `details_json`, `created_at`
)
SELECT
	`id`, `tenant_id`, `lead_id`, `actor_type`, `actor_id`, `action`, `authority`,
	NULL, 'system', `lead_id`, 'legacy_' || `id`, `details_json`, `created_at`
FROM `audit_events`;
--> statement-breakpoint
DROP TABLE `audit_events`;
--> statement-breakpoint
ALTER TABLE `__new_audit_events` RENAME TO `audit_events`;
--> statement-breakpoint
CREATE INDEX `audit_tenant_created_idx` ON `audit_events` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_tenant_lead_idx` ON `audit_events` (`tenant_id`,`lead_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `audit_tenant_correlation_action_idx` ON `audit_events` (`tenant_id`,`correlation_id`,`action`);--> statement-breakpoint
ALTER TABLE `follow_ups` ADD `source_send_operation_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `followups_send_operation_idx` ON `follow_ups` (`tenant_id`,`source_send_operation_id`);--> statement-breakpoint
ALTER TABLE `messages` ADD `send_state` text DEFAULT 'received' NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `idempotency_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `messages_tenant_idempotency_idx` ON `messages` (`tenant_id`,`idempotency_key`);
