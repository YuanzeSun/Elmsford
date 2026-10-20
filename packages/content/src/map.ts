// 小地图。故事背景固定时，所有村子都用下面这张手画的；以后故事背景按局生成时，打开 DRAW_MAPS，
// 让模型照着地理画（prompts/map.md），代码按这里的规矩检查方位，画不出来再退回手画的。

import type { MapRules } from "@elmsford/core";
import { locations } from "./seeds/locations";

export const mapRules: MapRules = {
  maxWidth: 40,
  maxHeight: 20,
  minHeight: 12,
  // The road north is a direction, not a place to stand; it isn't drawn.
  required: locations.filter((l) => !l.offstage && l.id !== "manor_road").map((l) => ({ id: l.id, short: l.short })),
  extraWords: ["埃尔河"],
  regions: [
    { id: "north_wood", from: 0, to: 0.3, where: "最北边" },
    { id: "manor", from: 0, to: 0.3, where: "最北边" },
    { id: "green", from: 0.3, to: 0.7, where: "中间" },
    { id: "ford", from: 0.65, to: 1, where: "南边，挨着河" },
    { id: "mill", from: 0.65, to: 1, where: "南边，挨着河" },
    { id: "meadow", from: 0.55, to: 1, where: "南边，沿着河" },
  ],
  near: [
    { a: "church", b: "churchyard", within: 6 },
    { a: "priest_house", b: "church", within: 6 },
    { a: "player_house", b: "churchyard", within: 6 },
    { a: "alehouse", b: "ford", within: 6 },
    { a: "green_house", b: "green", within: 8 },
    { a: "church", b: "green", within: 10 },
    { a: "atwood_cottage", b: "common", within: 8 },
    { a: "lane", b: "green", within: 6 },
  ],
  bearings: [
    { a: "manor", dir: "north", b: "green" },
    { a: "north_wood", dir: "north", b: "green" },
    { a: "east_field", dir: "north", b: "green" },
    { a: "west_field", dir: "north", b: "green" },
    { a: "east_field", dir: "east", b: "west_field" },
    { a: "alehouse", dir: "north", b: "ford" },
    { a: "alehouse", dir: "south", b: "green" },
    { a: "mill", dir: "east", b: "ford" },
  ],
  river: {
    chars: "~=",
    crossings: ["ford"],
    banks: [
      { id: "mill", within: 2 },
      { id: "meadow", within: 3 },
    ],
  },
};

/**
 * Whether each new village gets a map drawn by the model (prompts/map.md). Off while the story
 * is fixed — every village is this same Elmsford, so the map below is used. Turn it on once
 * villages (and their backgrounds) are generated per game.
 */
export const DRAW_MAPS = false;

/** Elmsford, drawn by hand. Each character is one cell. */
export const villageMap: string[] = [
  " ^ ^^ ^^^ ^ ^^ ^ ^    ###########",
  "^^ ^^ 林子 ^^ ^ ^^      #   庄园  #",
  " ^^ ^^^ ^ ^^ ^  ^     #####.#####",
  " ^   ^  ^                  .",
  " ,,,,,,,,,,  ,,,,,,,,,,    .  ,,,,,,,,,,",
  " ,,, 西田 ,,,  ,,, 南田 ,,,    .  ,,, 东田 ,,,",
  " ,,,,,,,,,,  ,,,,,,,,,,    .  ,,,,,,,,,,",
  "                           .",
  " ,, 公地 ,,                  .",
  "  ,  ,  ,                  .",
  " 茅舍                ........      神父家",
  "         格林家....井边      + 墓园 + 教堂",
  "        巷子        o     + + +",
  "               .         你家",
  "              酒馆       ,, 草场 ,,",
  "               .                 磨坊",
  "~~~~~~~~~~~~~~=渡口=~~~~~~~~~~~~~~~~~~~~",
  "~~~~~~ 埃尔河 ~~~~~~~~~~~~~~~~~~~~~~~~~~",
  " ~~~~   ~~~~~~~~   ~~~~~~~~~~   ~~~~~~",
];
