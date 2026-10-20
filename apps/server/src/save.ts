// Save files (M6): the whole village as one JSON document, to move it between machines.
// LLM call logs and dev settings stay behind; they're about this machine, not the village.

import { eq, inArray } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Db } from "./db/client";
import * as t from "./db/schema";

export const SAVE_FORMAT = "elmsford-save/1";

const BY_VILLAGE = {
  characters: t.characters,
  newcomers: t.newcomers,
  relationships: t.relationships,
  facts: t.facts,
  memories: t.memories,
  commitments: t.commitments,
  inventory: t.inventory,
  conversations: t.conversations,
  notebook: t.notebook,
  dayPlans: t.dayPlans,
  documents: t.documents,
  worldEvents: t.worldEvents,
  villageDays: t.villageDays,
  recaps: t.recaps,
  personaNotes: t.personaNotes,
  remotePeople: t.remotePeople,
  notifications: t.notifications,
  lore: t.lore,
  rejections: t.rejections,
} as const;

type Tables = keyof typeof BY_VILLAGE;

export interface SaveFile {
  format: typeof SAVE_FORMAT;
  exportedAt: number;
  village: typeof t.villages.$inferSelect;
  factKnowledge: (typeof t.factKnowledge.$inferSelect)[];
  tables: Record<Tables, unknown[]>;
}

const villageCol = (table: SQLiteTable) => (table as unknown as { villageId: Parameters<typeof eq>[0] }).villageId;

export function exportSave(db: Db, villageId: string, now: number): SaveFile | null {
  const village = db.select().from(t.villages).where(eq(t.villages.id, villageId)).get();
  if (!village) return null;
  const tables = {} as Record<Tables, unknown[]>;
  for (const [name, table] of Object.entries(BY_VILLAGE) as [Tables, SQLiteTable][]) {
    tables[name] = db.select().from(table).where(eq(villageCol(table), villageId)).all();
  }
  const factIds = (tables.facts as { id: string }[]).map((f) => f.id);
  const factKnowledge = factIds.length ? db.select().from(t.factKnowledge).where(inArray(t.factKnowledge.factId, factIds)).all() : [];
  return { format: SAVE_FORMAT, exportedAt: now, village, factKnowledge, tables };
}

/** Remove a village and everything in it. LLM call logs stay (they're about this machine). */
export function deleteVillage(db: Db, villageId: string) {
  const oldFacts = db.select({ id: t.facts.id }).from(t.facts).where(eq(t.facts.villageId, villageId)).all().map((f) => f.id);
  if (oldFacts.length) db.delete(t.factKnowledge).where(inArray(t.factKnowledge.factId, oldFacts)).run();
  for (const table of Object.values(BY_VILLAGE)) db.delete(table).where(eq(villageCol(table), villageId)).run();
  db.delete(t.villages).where(eq(t.villages.id, villageId)).run();
}

/** Replace the village with a save file. Everything about the old village is deleted first. */
export function importSave(db: Db, villageId: string, save: SaveFile) {
  if (save.format !== SAVE_FORMAT) throw new Error(`不认识的存档格式：${String(save.format)}`);
  db.transaction((tx) => {
    deleteVillage(tx as unknown as Db, villageId);

    tx.insert(t.villages).values({ ...save.village, id: villageId }).run();
    for (const [name, table] of Object.entries(BY_VILLAGE) as [Tables, SQLiteTable][]) {
      const rows = (save.tables[name] ?? []).map((r) => ({ ...(r as object), villageId }));
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        if (chunk.length) tx.insert(table).values(chunk as never).run();
      }
    }
    for (let i = 0; i < save.factKnowledge.length; i += 200) {
      const chunk = save.factKnowledge.slice(i, i + 200);
      if (chunk.length) tx.insert(t.factKnowledge).values(chunk).run();
    }
  });
}
