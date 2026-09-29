CREATE TABLE `agent_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`job_id` text NOT NULL,
	`task` text NOT NULL,
	`target_lang` text NOT NULL,
	`file_path` text NOT NULL,
	`result_path` text NOT NULL,
	`key_map` text NOT NULL,
	`status` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`seq` integer DEFAULT 0 NOT NULL,
	`leased_at` text,
	`lease_until` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`imported_at` text,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_batches_queue` ON `agent_batches` (`status`,`priority`,`seq`);--> statement-breakpoint
CREATE INDEX `agent_batches_book` ON `agent_batches` (`book_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`book_id` text NOT NULL,
	`event` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `translation_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`segment_id` text NOT NULL,
	`lang` text NOT NULL,
	`before` text,
	`after` text NOT NULL,
	`actor` text NOT NULL,
	`reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`segment_id`) REFERENCES `segments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `revisions_segment` ON `translation_revisions` (`segment_id`,`lang`,`created_at`);--> statement-breakpoint
ALTER TABLE `glossary_terms` ADD `confidence` real;--> statement-breakpoint
ALTER TABLE `jobs` ADD `seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `jobs_book` ON `jobs` (`book_id`,`stage`);--> statement-breakpoint
ALTER TABLE `translations` ADD `suggestion` text;--> statement-breakpoint
ALTER TABLE `translations` ADD `prompt_version` text;--> statement-breakpoint
CREATE INDEX `translations_status` ON `translations` (`lang`,`status`);