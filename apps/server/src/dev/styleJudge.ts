// 风格裁判（技术设计 §6）：按设定圣经 §6 给一段文字打分。也是 M0 检查 LLM 网关是否通的入口。

import { loadPrompt, renderPrompt } from "@elmsford/content";
import { z } from "zod";
import type { LlmGateway } from "../llm/gateway";

export const StyleVerdict = z.object({
  score: z.number().int().describe("1 到 10"),
  issues: z.array(
    z.object({
      kind: z.enum(["archaic", "modern", "quest_giver", "too_warm", "exposition", "flat_voice", "other"]),
      quote: z.string(),
      why: z.string(),
    }),
  ),
  verdict: z.string(),
});

export type StyleVerdict = z.infer<typeof StyleVerdict>;

export async function judgeStyle(gateway: LlmGateway, text: string, villageId?: string) {
  const result = await gateway.callJson(
    {
      tier: "cheap",
      purpose: "dev.style_judge",
      ...(villageId ? { villageId } : {}),
      system: [{ text: loadPrompt("world"), cache: true }],
      messages: [{ role: "user", content: renderPrompt("style-judge", { text }) }],
      maxTokens: 4000,
      effort: "low",
      cacheKey: "elmsford.style_judge",
    },
    "style_verdict",
    StyleVerdict,
  );
  const score = Math.min(10, Math.max(1, result.data.score));
  return { ...result, data: { ...result.data, score } };
}
