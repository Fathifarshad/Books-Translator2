CREATE TABLE `book_targets` (
	`book_id` text NOT NULL,
	`lang` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`engine_overrides` text,
	`done_count` integer DEFAULT 0 NOT NULL,
	`total_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`book_id`, `lang`),
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `books` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`source_lang` text NOT NULL,
	`titles` text NOT NULL,
	`subtitles` text,
	`authors` text NOT NULL,
	`publisher` text,
	`year` integer,
	`isbn` text,
	`page_count` integer DEFAULT 0 NOT NULL,
	`page_labels` text NOT NULL,
	`file_path` text,
	`file_sha256` text,
	`file_name` text,
	`brief` text,
	`settings` text DEFAULT '{}' NOT NULL,
	`report` text,
	`status` text NOT NULL,
	`error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `books_owner_sha` ON `books` (`owner_id`,`file_sha256`);--> statement-breakpoint
CREATE TABLE `glossary_terms` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text,
	`src_lang` text NOT NULL,
	`tgt_lang` text NOT NULL,
	`src` text NOT NULL,
	`tgt` text NOT NULL,
	`alternatives` text DEFAULT '[]' NOT NULL,
	`definition` text,
	`kind` text NOT NULL,
	`parenthetical` text NOT NULL,
	`status` text NOT NULL,
	`occurrences` integer DEFAULT 0 NOT NULL,
	`notes` text,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`target_lang` text,
	`stage` text NOT NULL,
	`scope` text,
	`engine` text DEFAULT 'local' NOT NULL,
	`status` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_until` text,
	`depends_on` text,
	`progress` text,
	`error` text,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `jobs_queue` ON `jobs` (`status`,`priority`,`created_at`);--> statement-breakpoint
CREATE TABLE `segments` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`node_id` text NOT NULL,
	`ord` integer NOT NULL,
	`type` text NOT NULL,
	`src` text NOT NULL,
	`page` integer NOT NULL,
	`page_end` integer NOT NULL,
	`bbox` text,
	`meta` text DEFAULT '{}' NOT NULL,
	`src_hash` text NOT NULL,
	`word_count` integer DEFAULT 0 NOT NULL,
	`translatable` integer NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `segments_node` ON `segments` (`node_id`,`ord`);--> statement-breakpoint
CREATE INDEX `segments_book` ON `segments` (`book_id`);--> statement-breakpoint
CREATE TABLE `toc_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`parent_id` text,
	`ord` integer NOT NULL,
	`depth` integer NOT NULL,
	`kind` text NOT NULL,
	`number_label` text,
	`heading_segment_id` text,
	`title` text,
	`page_start` integer NOT NULL,
	`page_end` integer NOT NULL,
	`skip` integer DEFAULT false NOT NULL,
	`origin` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `toc_nodes_book` ON `toc_nodes` (`book_id`,`parent_id`,`ord`);--> statement-breakpoint
CREATE TABLE `translations` (
	`segment_id` text NOT NULL,
	`lang` text NOT NULL,
	`draft` text,
	`final` text,
	`status` text NOT NULL,
	`engine` text NOT NULL,
	`model` text,
	`confidence` real,
	`note` text,
	`flags` text DEFAULT '[]' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`segment_id`, `lang`),
	FOREIGN KEY (`segment_id`) REFERENCES `segments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
