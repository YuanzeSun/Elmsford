import type { GameTime } from "@elmsford/core";
import { useEffect } from "react";

export type Palette = "dawn" | "day" | "dusk" | "night" | "deep";

/** 清晨、白天、黄昏、夜晚、深夜 (技术设计 §5). */
export function paletteOf(gt: GameTime): Palette {
  if (gt.period === "deep_night") return "deep";
  if (gt.period === "dawn") return "dawn";
  if (gt.period === "evening" || gt.period === "night") return gt.light === "night" ? "night" : "dusk";
  return "day";
}

/** Every page takes its colours from the village's hour. */
export function usePalette(gt: GameTime | undefined) {
  useEffect(() => {
    if (!gt) return;
    document.body.dataset.palette = paletteOf(gt);
    const bg = getComputedStyle(document.body).getPropertyValue("--bg").trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg || "#f4efe4");
  }, [gt]);
}
