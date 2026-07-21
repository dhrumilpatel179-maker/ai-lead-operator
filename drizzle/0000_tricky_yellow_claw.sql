CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`lead_id` text,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`authority` text,
	`details_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_tenant_created_idx` ON `audit_events` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_tenant_lead_idx` ON `audit_events` (`tenant_id`,`lead_id`);--> statement-breakpoint
CREATE TABLE `business_settings` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`timezone` text DEFAULT 'America/Chicago' NOT NULL,
	`business_hours_json` text DEFAULT '{}' NOT NULL,
	`services_json` text DEFAULT '[]' NOT NULL,
	`prohibited_claims_json` text DEFAULT '[]' NOT NULL,
	`authority_rules_json` text DEFAULT '{}' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `follow_ups` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`due_at` text NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `followups_tenant_due_idx` ON `follow_ups` (`tenant_id`,`state`,`due_at`);--> statement-breakpoint
CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`vehicle` text NOT NULL,
	`vehicle_year` text,
	`vehicle_make` text,
	`vehicle_model` text,
	`vehicle_mileage` text,
	`service` text NOT NULL,
	`symptoms` text NOT NULL,
	`urgency` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`authority` text NOT NULL,
	`summary` text NOT NULL,
	`next_action` text NOT NULL,
	`next_follow_up` text NOT NULL,
	`assigned_human` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `leads_tenant_status_idx` ON `leads` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `leads_tenant_followup_idx` ON `leads` (`tenant_id`,`next_follow_up`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`direction` text NOT NULL,
	`channel` text NOT NULL,
	`body` text NOT NULL,
	`sent_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_tenant_lead_idx` ON `messages` (`tenant_id`,`lead_id`);--> statement-breakpoint
CREATE TABLE `response_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`body` text NOT NULL,
	`authority` text NOT NULL,
	`state` text NOT NULL,
	`approved_by` text,
	`approved_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `drafts_tenant_state_idx` ON `response_drafts` (`tenant_id`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `drafts_lead_active_idx` ON `response_drafts` (`tenant_id`,`lead_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `tenant_memberships` (
	`tenant_id` text NOT NULL,
	`user_email` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `user_email`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memberships_email_idx` ON `tenant_memberships` (`user_email`);--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
