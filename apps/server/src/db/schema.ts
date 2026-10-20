// World state (技术设计 §4.2). Times are epoch milliseconds of the game clock.

import type { DailyEconomy } from "@elmsford/content";
import type { CharacterSeed, CharacterState, PlanBlock, ResidentStatus, Routine, VillageMap, Weather } from "@elmsford/core";
import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const villages = sqliteTable("villages", {
  id: text("id").primaryKey(),
  timeZone: text("time_zone").notNull(),
  createdAt: integer("created_at").notNull(),
  playerLocationId: text("player_location_id").notNull(),
  /** In pennies. */
  playerMoney: integer("player_money").notNull(),
  lastSeenAt: integer("last_seen_at"),
  /** Game time up to which the background simulation has run. */
  simulatedUntil: integer("simulated_until"),
  /** Drawn by the model once for this village; null until then (the fallback map is used). */
  map: text("map", { mode: "json" }).$type<VillageMap>(),
  /** When the player walked in (after the intro). Nothing is simulated before. */
  startedAt: integer("started_at"),
  /**
   * Chosen once, when the game starts: "story" — the village's own clock, moving only when the
   * player does something or rests; "real" — the same day as the player's.
   */
  timeMode: text("time_mode", { enum: ["story", "real"] }).notNull().default("story"),
  /** Story mode: the village's clock (game time). */
  storyAt: integer("story_at"),
});

export interface DirectorHappening {
  kind: string;
  text: string;
  characterId?: string;
}

/** One record per village per game day: weather, how quiet things were, what the director added. */
export const villageDays = sqliteTable(
  "village_days",
  {
    villageId: text("village_id").notNull(),
    date: text("date").notNull(),
    weather: text("weather", { mode: "json" }).$type<Weather>().notNull(),
    /** 0 (eventful) … 1 (nothing at all happened). */
    calm: real("calm"),
    happenings: text("happenings", { mode: "json" }).$type<DirectorHappening[]>().notNull().default([]),
    /** How this day was simulated: "slots" (hour by hour), "day" or "week" summary. */
    mode: text("mode"),
    planned: integer("planned", { mode: "boolean" }).notNull().default(false),
    /** Rules (wages, meals, health) applied for this day. */
    settled: integer("settled", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.villageId, t.date] })],
);

/** "这几天": what the player saw and heard on coming back. */
export const recaps = sqliteTable("recaps", {
  id: text("id").primaryKey(),
  villageId: text("village_id").notNull(),
  fromAt: integer("from_at").notNull(),
  toAt: integer("to_at").notNull(),
  createdAt: integer("created_at").notNull(),
  /** "away" — the player was gone; "rested" — in story mode, they let a day go by. */
  kind: text("kind", { enum: ["away", "rested"] }).notNull().default("away"),
  status: text("status", { enum: ["pending", "ready", "failed"] }).notNull(),
  text: text("text").notNull().default(""),
  seenAt: integer("seen_at"),
});

/** The only way personality moves: weekly reflection, small steps, always with a reason. */
export const personaNotes = sqliteTable("persona_notes", {
  id: text("id").primaryKey(),
  villageId: text("village_id").notNull(),
  characterId: text("character_id").notNull(),
  at: integer("at").notNull(),
  text: text("text").notNull(),
  reason: text("reason").notNull(),
});

/** People off the map who letters go to and come back from. */
export const remotePeople = sqliteTable("remote_people", {
  id: text("id").primaryKey(),
  villageId: text("village_id").notNull(),
  name: text("name").notNull(),
  /** How they relate to the resident who writes to them. */
  relation: text("relation").notNull(),
  linkedCharacterId: text("linked_character_id").notNull(),
  /** Who they are, invented once when the first letter goes out, then fixed. */
  description: text("description").notNull(),
  place: text("place").notNull(),
  alive: integer("alive", { mode: "boolean" }).notNull(),
  createdAt: integer("created_at").notNull(),
});

/** Gentle nudges for the player: "琼在你门口留了一篮苹果". Daily-capped. */
export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  villageId: text("village_id").notNull(),
  at: integer("at").notNull(),
  text: text("text").notNull(),
  characterId: text("character_id"),
  deliveredAt: integer("delivered_at"),
});

export const characters = sqliteTable(
  "characters",
  {
    villageId: text("village_id").notNull(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    shortName: text("short_name").notNull(),
    age: integer("age").notNull(),
    /** Read-only after seeding. */
    seed: text("seed", { mode: "json" }).$type<CharacterSeed>().notNull(),
    state: text("state", { mode: "json" }).$type<CharacterState>().notNull(),
    /** Only those "here" are simulated; the gone and the dead are still remembered. */
    status: text("status", { enum: ["here", "gone", "dead"] }).$type<ResidentStatus>().notNull(),
    /** The opening seeds, a villager who stepped forward, or someone who came from outside. */
    origin: text("origin", { enum: ["seed", "folk", "arrival"] }).notNull(),
    /** Their ordinary day: the planner works from it, and it's used when there's no plan. */
    routine: text("routine", { mode: "json" }).$type<Routine>().notNull(),
    /** Daily earnings and spending; null for none. */
    economy: text("economy", { mode: "json" }).$type<DailyEconomy>(),
    /** When they joined the simulated village (null for the opening residents). */
    joinedAt: integer("joined_at"),
    /** For someone passing through: the date ("YYYY-MM-DD") they move on. */
    leavesOn: text("leaves_on"),
    /** When they left or died. */
    endedAt: integer("ended_at"),
  },
  (t) => [primaryKey({ columns: [t.villageId, t.id] })],
);

/**
 * Someone about to join the residents: decided by rule (a villager talked about enough, a
 * stranger in season), then written by the model when their time comes.
 */
export const newcomers = sqliteTable("newcomers", {
  id: text("id").primaryKey(),
  villageId: text("village_id").notNull(),
  kind: text("kind", { enum: ["folk", "arrival"] }).notNull(),
  /** The folk entry or the opening in content. */
  sourceId: text("source_id").notNull(),
  characterId: text("character_id").notNull(),
  /** Game time they join. */
  at: integer("at").notNull(),
  status: text("status", { enum: ["pending", "done", "dropped"] }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const relationships = sqliteTable(
  "relationships",
  {
    villageId: text("village_id").notNull(),
    fromId: text("from_id").notNull(),
    toId: text("to_id").notNull(),
    trust: integer("trust").notNull(),
    affection: integer("affection").notNull(),
    summary: text("summary").notNull(),
  },
  (t) => [primaryKey({ columns: [t.villageId, t.fromId, t.toId] })],
);

export const facts = sqliteTable(
  "facts",
  {
    id: text("id").primaryKey(),
    villageId: text("village_id").notNull(),
    text: text("text").notNull(),
    at: integer("at").notNull(),
  },
  (t) => [index("facts_village_at").on(t.villageId, t.at)],
);

export const factKnowledge = sqliteTable(
  "fact_knowledge",
  {
    factId: text("fact_id").notNull(),
    characterId: text("character_id").notNull(),
    belief: real("belief").notNull(),
    source: text("source").notNull(),
  },
  (t) => [primaryKey({ columns: [t.factId, t.characterId] })],
);

export const memories = sqliteTable(
  "memories",
  {
    id: text("id").primaryKey(),
    villageId: text("village_id").notNull(),
    characterId: text("character_id").notNull(),
    at: integer("at").notNull(),
    text: text("text").notNull(),
    importance: integer("importance").notNull(),
    participants: text("participants", { mode: "json" }).$type<string[]>().notNull(),
    factIds: text("fact_ids", { mode: "json" }).$type<string[]>().notNull(),
    lastRecalledAt: integer("last_recalled_at"),
    /** "event" for things that happened, "reflection" for weekly views. */
    kind: text("kind", { enum: ["event", "reflection"] }).notNull().default("event"),
    /** Faded by weekly reflection; old details count for less. */
    weight: real("weight").notNull().default(1),
  },
  (t) => [index("memories_character_at").on(t.villageId, t.characterId, t.at)],
);

export const commitments = sqliteTable("commitments", {
  /** Set when status changed, for "这几天" and reflection. */
  resolvedAt: integer("resolved_at"),
  id: text("id").primaryKey(),
  villageId: text("village_id").notNull(),
  byId: text("by_id").notNull(),
  toId: text("to_id").notNull(),
  text: text("text").notNull(),
  due: integer("due"),
  status: text("status", { enum: ["open", "kept", "broken", "released"] }).notNull(),
  createdAt: integer("created_at").notNull(),
});

/** Who owns what. ownerId is a character id, "player", or "loc:<locationId>" for things left somewhere. */
export const inventory = sqliteTable(
  "inventory",
  {
    villageId: text("village_id").notNull(),
    ownerId: text("owner_id").notNull(),
    item: text("item").notNull(),
    quantity: integer("quantity").notNull(),
  },
  (t) => [primaryKey({ columns: [t.villageId, t.ownerId, t.item] })],
);

export interface TranscriptLine {
  /** "player", the character id, "narration" for the resident's carried-out actions, "scene" for stage directions. */
  speaker: string;
  text: string;
  at: number;
}

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    villageId: text("village_id").notNull(),
    characterId: text("character_id").notNull(),
    locationId: text("location_id").notNull(),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at"),
    endedBy: text("ended_by", { enum: ["player", "character", "time"] }),
    transcript: text("transcript", { mode: "json" }).$type<TranscriptLine[]>().notNull(),
    /** The situation block, frozen when the conversation started so the prompt prefix stays stable. */
    situation: text("situation").notNull().default(""),
    recalledMemoryIds: text("recalled_memory_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
    /** Extraction state: null until the conversation ends. */
    extraction: text("extraction", { enum: ["pending", "done", "failed"] }),
  },
  (t) => [index("conversations_character").on(t.villageId, t.characterId, t.startedAt)],
);

/** The player's notebook, by person: some lines written automatically, some by the player. */
export const notebook = sqliteTable(
  "notebook",
  {
    id: text("id").primaryKey(),
    villageId: text("village_id").notNull(),
    characterId: text("character_id").notNull(),
    at: integer("at").notNull(),
    text: text("text").notNull(),
    byPlayer: integer("by_player", { mode: "boolean" }).notNull(),
  },
  (t) => [index("notebook_character").on(t.villageId, t.characterId)],
);

/** What residents have told the player about the village's customs, in their words. */
export const lore = sqliteTable(
  "lore",
  {
    id: text("id").primaryKey(),
    villageId: text("village_id").notNull(),
    key: text("key").notNull(),
    text: text("text").notNull(),
    source: text("source").notNull(),
    at: integer("at").notNull(),
  },
  (t) => [index("lore_village_key").on(t.villageId, t.key)],
);

/** Proposed changes the validator refused, kept for the dev tools. */
export const rejections = sqliteTable("rejections", {
  id: text("id").primaryKey(),
  villageId: text("village_id").notNull(),
  at: integer("at").notNull(),
  source: text("source").notNull(),
  field: text("field").notNull(),
  item: text("item", { mode: "json" }).notNull(),
  reason: text("reason").notNull(),
});

export const dayPlans = sqliteTable(
  "day_plans",
  {
    villageId: text("village_id").notNull(),
    characterId: text("character_id").notNull(),
    date: text("date").notNull(),
    blocks: text("blocks", { mode: "json" }).$type<PlanBlock[]>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.villageId, t.characterId, t.date] })],
);

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  villageId: text("village_id").notNull(),
  kind: text("kind", { enum: ["letter", "contract", "will", "record"] }).notNull(),
  commissionedBy: text("commissioned_by").notNull(),
  dictated: text("dictated").notNull(),
  written: text("written").notNull(),
  recipient: text("recipient"),
  status: text("status", { enum: ["draft", "sent", "delivered", "replied"] }).notNull(),
  createdAt: integer("created_at").notNull(),
  /** What the client asked for when commissioning, in their words. */
  gist: text("gist").notNull().default(""),
  remotePersonId: text("remote_person_id"),
  /** For replies: the letter this answers. */
  replyToId: text("reply_to_id"),
  /** Ready to go with the Thursday carrier. */
  sealedAt: integer("sealed_at"),
  sentAt: integer("sent_at"),
  /** When the reply (if any) will arrive. */
  replyDueAt: integer("reply_due_at"),
  deliveredAt: integer("delivered_at"),
  /** When the player read it out to the person it was for. */
  readAt: integer("read_at"),
  /** What the player actually read aloud (may differ from the letter!). */
  readAloud: text("read_aloud"),
  feePence: integer("fee_pence"),
});

export type WorldEventRow = typeof worldEvents.$inferSelect;

export const worldEvents = sqliteTable(
  "world_events",
  {
    id: text("id").primaryKey(),
    villageId: text("village_id").notNull(),
    at: integer("at").notNull(),
    type: text("type").notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    visibleTo: text("visible_to", { mode: "json" }).$type<string[]>().notNull(),
  },
  (t) => [index("world_events_village_at").on(t.villageId, t.at)],
);

/** Every LLM call, successful or not: prompt, output, tokens, cost estimate, latency. */
export const llmCalls = sqliteTable(
  "llm_calls",
  {
    id: text("id").primaryKey(),
    villageId: text("village_id"),
    /** Real wall-clock time, for the global daily cap. */
    startedAt: integer("started_at").notNull(),
    /** Game time and the village's local game date, for the per-village daily budget. */
    gameAt: integer("game_at").notNull(),
    gameDate: text("game_date"),
    purpose: text("purpose").notNull(),
    tierRequested: text("tier_requested").notNull(),
    tierUsed: text("tier_used").notNull(),
    provider: text("provider"),
    model: text("model"),
    status: text("status", { enum: ["ok", "refused", "error", "over_budget", "unavailable"] }).notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    stopReason: text("stop_reason"),
    error: text("error"),
    request: text("request", { mode: "json" }).notNull(),
    response: text("response"),
    toolCalls: text("tool_calls", { mode: "json" }),
  },
  (t) => [index("llm_calls_started").on(t.startedAt), index("llm_calls_village_date").on(t.villageId, t.gameDate)],
);

/** Small server-wide settings, e.g. the dev fake clock. */
export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
});
