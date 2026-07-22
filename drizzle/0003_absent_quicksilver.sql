ALTER TABLE `leads` ADD `escalation_reasons_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `immediate_escalation` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `disposition` text DEFAULT 'reply' NOT NULL;