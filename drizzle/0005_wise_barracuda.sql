PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_provider_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_account_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`granted_scopes_json` text DEFAULT '[]' NOT NULL,
	`credential_envelope_ciphertext` text,
	`credential_envelope_nonce` text,
	`credential_envelope_auth_tag` text,
	`credential_key_version` text,
	`credential_schema_version` integer,
	`gmail_watch_expires_at` text,
	`gmail_history_id` text,
	`reconnect_required_at` text,
	`revoked_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "provider_connections_status_check" CHECK("__new_provider_connections"."status" in ('pending','active','reconnect_required','revoked','error')),
	CONSTRAINT "provider_connections_scopes_json_check" CHECK(json_valid("__new_provider_connections"."granted_scopes_json") and json_type("__new_provider_connections"."granted_scopes_json") = 'array'),
	CONSTRAINT "provider_connections_envelope_check" CHECK((
      "__new_provider_connections"."status" in ('pending','revoked')
      and "__new_provider_connections"."credential_envelope_ciphertext" is null
      and "__new_provider_connections"."credential_envelope_nonce" is null
      and "__new_provider_connections"."credential_envelope_auth_tag" is null
      and "__new_provider_connections"."credential_key_version" is null
      and "__new_provider_connections"."credential_schema_version" is null
    ) or (
      "__new_provider_connections"."status" in ('active','reconnect_required','error')
      and "__new_provider_connections"."credential_envelope_ciphertext" is not null
      and "__new_provider_connections"."credential_envelope_nonce" is not null
      and "__new_provider_connections"."credential_envelope_auth_tag" is not null
      and "__new_provider_connections"."credential_key_version" is not null
      and "__new_provider_connections"."credential_schema_version" is not null
      and length("__new_provider_connections"."credential_envelope_ciphertext") > 0
      and length("__new_provider_connections"."credential_envelope_nonce") > 0
      and length("__new_provider_connections"."credential_envelope_auth_tag") > 0
      and length("__new_provider_connections"."credential_key_version") > 0
      and "__new_provider_connections"."credential_schema_version" > 0
    ) or (
      "__new_provider_connections"."status" in ('reconnect_required','error')
      and "__new_provider_connections"."credential_envelope_ciphertext" is null
      and "__new_provider_connections"."credential_envelope_nonce" is null
      and "__new_provider_connections"."credential_envelope_auth_tag" is null
      and "__new_provider_connections"."credential_key_version" is null
      and "__new_provider_connections"."credential_schema_version" is null
    )),
	CONSTRAINT "provider_connections_lifecycle_timestamp_check" CHECK((
      "__new_provider_connections"."status" = 'pending'
      and "__new_provider_connections"."reconnect_required_at" is null
      and "__new_provider_connections"."revoked_at" is null
    ) or (
      "__new_provider_connections"."status" = 'reconnect_required'
      and "__new_provider_connections"."reconnect_required_at" is not null
      and "__new_provider_connections"."revoked_at" is null
    ) or (
      "__new_provider_connections"."status" = 'revoked'
      and "__new_provider_connections"."revoked_at" is not null
    ) or (
      "__new_provider_connections"."status" in ('active','error')
      and "__new_provider_connections"."revoked_at" is null
    ))
);
--> statement-breakpoint
INSERT INTO `__new_provider_connections`(
	"id", "tenant_id", "provider", "external_account_id", "status",
	"granted_scopes_json", "credential_envelope_ciphertext",
	"credential_envelope_nonce", "credential_envelope_auth_tag",
	"credential_key_version", "credential_schema_version",
	"gmail_watch_expires_at", "gmail_history_id", "reconnect_required_at",
	"revoked_at", "created_at", "updated_at"
)
SELECT
	"id",
	"tenant_id",
	"provider",
	"external_account_id",
	"status",
	CASE WHEN "status" = 'revoked' THEN '[]' ELSE "granted_scopes_json" END,
	CASE WHEN "status" = 'revoked' THEN NULL ELSE "credential_envelope_ciphertext" END,
	CASE WHEN "status" = 'revoked' THEN NULL ELSE "credential_envelope_nonce" END,
	CASE WHEN "status" = 'revoked' THEN NULL ELSE "credential_envelope_auth_tag" END,
	CASE WHEN "status" = 'revoked' THEN NULL ELSE "credential_key_version" END,
	CASE
		WHEN "status" IN ('active','reconnect_required','error')
			AND "credential_envelope_ciphertext" IS NOT NULL
		THEN 1
		ELSE NULL
	END,
	CASE WHEN "status" = 'revoked' THEN NULL ELSE "gmail_watch_expires_at" END,
	CASE WHEN "status" = 'revoked' THEN NULL ELSE "gmail_history_id" END,
	CASE
		WHEN "status" = 'reconnect_required'
		THEN COALESCE("reconnect_required_at", "updated_at")
		ELSE "reconnect_required_at"
	END,
	CASE
		WHEN "status" = 'revoked'
		THEN COALESCE("revoked_at", "updated_at")
		ELSE "revoked_at"
	END,
	"created_at",
	"updated_at"
FROM `provider_connections`;--> statement-breakpoint
DROP TRIGGER `provider_outbox_chain_insert`;--> statement-breakpoint
DROP TABLE `provider_connections`;--> statement-breakpoint
ALTER TABLE `__new_provider_connections` RENAME TO `provider_connections`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `provider_connections_tenant_account_idx` ON `provider_connections` (`tenant_id`,`provider`,`external_account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `provider_connections_tenant_id_idx` ON `provider_connections` (`tenant_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `provider_connections_tenant_id_provider_idx` ON `provider_connections` (`tenant_id`,`id`,`provider`);--> statement-breakpoint
CREATE INDEX `provider_connections_tenant_status_idx` ON `provider_connections` (`tenant_id`,`status`);--> statement-breakpoint
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
END;
