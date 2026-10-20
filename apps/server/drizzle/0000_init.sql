CREATE TABLE `characters` (
	`village_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`short_name` text NOT NULL,
	`age` integer NOT NULL,
	`seed` text NOT NULL,
	`state` text NOT NULL,
	`status` text NOT NULL,
	`origin` text NOT NULL,
	`routine` text NOT NULL,
	`economy` text,
	`joined_at` integer,
	`leaves_on` text,
	`ended_at` integer,
	PRIMARY KEY(`village_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `commitments` (
	`resolved_at` integer,
	`id` text PRIMARY KEY NOT NULL,
	`village_id` text NOT NULL,
	`by_id` text NOT NULL,
	`to_id` text NOT NULL,
	`text` text NOT NULL,
	`due` integer,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`village_id` text NOT NULL,
	`character_id` text NOT NULL,
	`location_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`ended_by` text,
	`transcript` text NOT NULL,
	`situation` text DEFAULT '' NOT NULL,
	`recalled_memory_ids` text DEFAULT '[]' NOT NULL,
	`extraction` text
);
--> statement-breakpoint
CREATE INDEX `conversations_character` ON `conversations` (`village_id`,`character_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `day_plans` (
	`village_id` text NOT NULL,
	`character_id` text NOT NULL,
	`date` text NOT NULL,
	`blocks` text NOT NULL,
	PRIMARY KEY(`village_id`, `character_id`, `date`)
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`village_id` text NOT NULL,
	`kind` text NOT NULL,
	`commissioned_by` text NOT NULL,
	`dictated` text NOT NULL,
	`written` text NOT NULL,
	`recipient` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`gist` text DEFAULT '' NOT NULL,
	`remote_person_id` text,
	`reply_to_id` text,
	`sealed_at` integer,
	`sent_at` integer,
	`reply_due_at` integer,
	`delivered_at` integer,
	`read_at` integer,
	`read_aloud` text,
	`fee_pence` integer
);
--> statement-breakpoint
CREATE TABLE `fact_knowledge` (
	`fact_id` text NOT NULL,
	`character_id` text NOT NULL,
	`belief` real NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`fact_id`, `character_id`)
);
--> statement-breakpoint
CREATE TABLE `facts` (
	`id` text PRIMARY KEY NOT NULL,
	`village_id` text NOT NULL,
	`text` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `facts_village_at` ON `facts` (`village_id`,`at`);--> statement-breakpoint
CREATE TABLE `inventory` (
	`village_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`item` text NOT NULL,
	`quantity` integer NOT NULL,
	PRIMARY KEY(`village_id`, `owner_id`, `item`)
);
--> statement-breakpoint
CREATE TABLE `llm_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`village_id` text,
	`started_at` integer NOT NULL,
	`game_at` integer NOT NULL,
	`game_date` text,
	`purpose` text NOT NULL,
	`tier_requested` text NOT NULL,
	`tier_used` text NOT NULL,
	`provider` text,
	`model` text,
	`status` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`stop_reason` text,
	`error` text,
	`request` text NOT NULL,
	`response` text,
	`tool_calls` text
);
--> statement-breakpoint
CREATE INDEX `llm_calls_started` ON `llm_calls` (`started_at`);--> statement-breakpoint
CREATE INDEX `llm_calls_village_date` ON `llm_calls` (`village_id`,`game_date`);--> statement-breakpoint
CREATE TABLE `lore` (
	`id` text PRIMARY KEY NOT NULL,
	`village_id` text NOT NULL,
	`key` text NOT NULL,
	`text` text NOT NULL,
	`source` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `lore_village_key` ON `lore` (`village_id`,`key`);--> statement-breakpoint
CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`village_id` text NOT NULL,
	`character_id` text NOT NULL,
	`at` integer NOT NULL,
	`text` text NOT NULL,
	`importance` integer NOT NULL,
	`participants` text NOT NULL,
	`fact_ids` text NOT NULL,
	`last_recalled_at` integer,
	`kind` text DEFAULT 'event' NOT NULL,
	`weight` real DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `memories_character_at` ON `memories` (`village_id`,`character_id`,`at`);--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `newcomers` (
	`id` text PRIMARY KEY NOT NULL,
	`village_id` text NOT NULL,
	`kind` text NOT NULL,
	`source_id` text NOT NULL,
	`character_id` text NOT NULL,
	`at` integer NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notebook` (
	`id` text PRIMARY KEY NOT NULL,
	`village_id` text NOT NULL,
	`character_id` text NOT NULL,
	`at` integer NOT NULL,
	`text` text NOT NULL,
	`by_player` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notebook_character` ON `notebook` (`village_id`,`character_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`village_id` text NOT NULL,
	`at` integer NOT NULL,
	`text` text NOT NULL,
	`character_id` text,
	`delivered_at` integer
);
--> statement-breakpoint
CREATE TABLE `persona_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`village_id` text NOT NULL,
	`character_id` text NOT NULL,
	`at` integer NOT NULL,
	`text` text NOT NULL,
	`reason` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recaps` (
	`id` text PRIMARY KEY NOT NULL,
	`village_id` text NOT NULL,
	`from_at` integer NOT NULL,
	`to_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`kind` text DEFAULT 'away' NOT NULL,
	`status` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`seen_at` integer
);
--> statement-breakpoint
CREATE TABLE `rejections` (
	`id` text PRIMARY KEY NOT NULL,
	`village_id` text NOT NULL,
	`at` integer NOT NULL,
	`source` text NOT NULL,
	`field` text NOT NULL,
	`item` text NOT NULL,
	`reason` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `relationships` (
	`village_id` text NOT NULL,
	`from_id` text NOT NULL,
	`to_id` text NOT NULL,
	`trust` integer NOT NULL,
	`affection` integer NOT NULL,
	`summary` text NOT NULL,
	PRIMARY KEY(`village_id`, `from_id`, `to_id`)
);
--> statement-breakpoint
CREATE TABLE `remote_people` (
	`id` text PRIMARY KEY NOT NULL,
	`village_id` text NOT NULL,
	`name` text NOT NULL,
	`relation` text NOT NULL,
	`linked_character_id` text NOT NULL,
	`description` text NOT NULL,
	`place` text NOT NULL,
	`alive` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `village_days` (
	`village_id` text NOT NULL,
	`date` text NOT NULL,
	`weather` text NOT NULL,
	`calm` real,
	`happenings` text DEFAULT '[]' NOT NULL,
	`mode` text,
	`planned` integer DEFAULT false NOT NULL,
	`settled` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`village_id`, `date`)
);
--> statement-breakpoint
CREATE TABLE `villages` (
	`id` text PRIMARY KEY NOT NULL,
	`time_zone` text NOT NULL,
	`created_at` integer NOT NULL,
	`player_location_id` text NOT NULL,
	`player_money` integer NOT NULL,
	`last_seen_at` integer,
	`simulated_until` integer,
	`map` text,
	`started_at` integer,
	`time_mode` text DEFAULT 'story' NOT NULL,
	`story_at` integer
);
--> statement-breakpoint
CREATE TABLE `world_events` (
	`id` text PRIMARY KEY NOT NULL,
	`village_id` text NOT NULL,
	`at` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`visible_to` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `world_events_village_at` ON `world_events` (`village_id`,`at`);