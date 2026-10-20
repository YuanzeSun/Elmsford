// The village map. While the story is fixed, every village uses the hand-drawn one (content's
// villageMap). With DRAW_MAPS on, the model draws one per new village (prompts/map.md), checked
// by core's checkMap; a drawing that fails gets more tries with the problems spelled out, and
// the hand-drawn map stands in until (or unless) one passes.

import { villageMap, loadPrompt, locations, mapRules, renderPrompt } from "@elmsford/content";
import { checkMap, type VillageMap } from "@elmsford/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import type { LlmGateway } from "../llm/gateway";
import { getVillage, type Village } from "../village";

const MapSchema = z.object({ rows: z.array(z.string()) });
/** Tries per drawing; each failed try tells the model what was wrong. */
const MAX_ATTEMPTS = 3;

const FALLBACK: VillageMap = (() => {
  const r = checkMap(villageMap, mapRules);
  if (!r.ok) throw new Error(`fallback map is invalid: ${r.errors.join("; ")}`);
  return r.map;
})();

export function mapFor(village: Village): VillageMap {
  return village.map ?? FALLBACK;
}

function placeList(): string {
  const byId = new Map(locations.map((l) => [l.id, l]));
  return locations
    .filter((l) => !l.offstage && mapRules.required.some((r) => r.id === l.id))
    .map((l) => {
      const near = l.neighbors.map((n) => byId.get(n)?.short).filter((x) => x && mapRules.required.some((r) => r.short === x)).join("、");
      return `- ${l.short}：${l.name}，${l.description}${near ? ` 挨着：${near}` : ""}`;
    })
    .join("\n");
}

/** Draw and keep a map for the village. Returns false when the model couldn't produce a valid one. */
export async function drawMap(db: Db, gateway: LlmGateway, villageId: string): Promise<boolean> {
  const village = getVillage(db, villageId);
  if (!village || village.map) return Boolean(village?.map);

  const task = renderPrompt("map", { width: String(mapRules.maxWidth), height: String(mapRules.maxHeight), places: placeList() });
  const messages: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: task }];

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const r = await gateway.callJson(
      {
        tier: "planner",
        purpose: "world.map",
        villageId,
        background: true,
        system: [{ text: loadPrompt("world"), cache: true }],
        messages,
        maxTokens: 6000,
        effort: "medium",
      },
      "village_map",
      MapSchema,
    );
    const check = checkMap(r.data.rows, mapRules);
    if (check.ok) {
      db.update(t.villages).set({ map: check.map }).where(eq(t.villages.id, villageId)).run();
      return true;
    }
    messages.push(
      { role: "assistant", content: JSON.stringify(r.data) },
      { role: "user", content: `这张图有问题：\n${check.errors.map((e) => `- ${e}`).join("\n")}\n照规则重画一张。` },
    );
  }
  return false;
}
