// 每个人寻常的一天，按钟声排（钟点随季节变）。没有当天的日程时就照这个过。
// 这是生活习惯，不是剧情：谁几点去哪，和真实的村子一样有规律。

import type { Routine } from "@elmsford/core";

export const sleepAt = (home: string, wake = "dawn-30", bed = "curfew+15") => [
  { from: "00:00", to: wake, locationId: home, activity: "睡觉", asleep: true },
  { from: bed, to: "24:00", locationId: home, activity: "睡觉", asleep: true },
];

export const routines: Record<string, Routine> = {
  matilda: {
    workday: [
      ...sleepAt("alehouse", "dawn-45", "curfew+60"),
      { from: "dawn-45", to: "noon-60", locationId: "alehouse", activity: "烧水、泡麦芽、照看酒桶" },
      { from: "noon-60", to: "noon+15", locationId: "green", activity: "在井边打水，顺便听听村里的新闻" },
      { from: "noon+15", to: "vespers", locationId: "alehouse", activity: "滤酒、装罐，给上门的人打酒" },
      { from: "vespers", to: "curfew+60", locationId: "alehouse", activity: "卖酒，酒馆里正热闹" },
    ],
    holyday: [
      ...sleepAt("alehouse", "dawn-15", "curfew+60"),
      { from: "dawn-15", to: "mass-15", locationId: "alehouse", activity: "收拾屋子" },
      { from: "mass-15", to: "mass+60", locationId: "church", activity: "望弥撒，站在后排" },
      { from: "mass+60", to: "noon+30", locationId: "green", activity: "弥撒散了，在井边和人说话" },
      { from: "noon+30", to: "curfew+60", locationId: "alehouse", activity: "卖酒，节日里客人多" },
    ],
  },
  thomas: {
    workday: [
      ...sleepAt("mill", "dawn-60", "curfew"),
      { from: "dawn-60", to: "noon", locationId: "mill", activity: "看水闸，磨面，过秤" },
      { from: "noon", to: "noon+30", locationId: "mill", activity: "在磨坊门口啃面包" },
      { from: "noon+30", to: "vespers+30", locationId: "mill", activity: "磨面，修补水轮上的木片" },
      { from: "vespers+30", to: "curfew", locationId: "mill", activity: "在家，记账" },
      { from: "vespers+30", to: "vespers+90", locationId: "alehouse", activity: "到玛蒂尔达家打一罐酒", days: [6] },
    ],
    holyday: [
      ...sleepAt("mill", "dawn-30", "curfew"),
      { from: "dawn-30", to: "mass-30", locationId: "mill", activity: "看一眼水闸" },
      { from: "mass-30", to: "mass+75", locationId: "church", activity: "领着一家人望弥撒，站在前排" },
      { from: "mass+75", to: "curfew", locationId: "mill", activity: "在家歇着，不干活" },
    ],
  },
  edmund: {
    workday: [
      ...sleepAt("priest_house", "dawn-60", "curfew+90"),
      { from: "dawn-60", to: "dawn+30", locationId: "church", activity: "一个人念晨祷" },
      { from: "dawn+30", to: "noon-30", locationId: "priest_house", activity: "读书，抄写讲道稿" },
      { from: "noon-30", to: "noon+60", locationId: "churchyard", activity: "在墓园里走走，看看新坟" },
      { from: "noon+60", to: "vespers-30", locationId: "priest_house", activity: "读书，准备礼拜" },
      { from: "vespers-30", to: "vespers+30", locationId: "church", activity: "念晚祷" },
      { from: "vespers+30", to: "curfew+90", locationId: "priest_house", activity: "在灯下读书" },
      { from: "curfew", to: "curfew+60", locationId: "alehouse", activity: "从后门溜进玛蒂尔达家喝一杯", days: [2, 5] },
    ],
    holyday: [
      ...sleepAt("priest_house", "dawn-60", "curfew+60"),
      { from: "dawn-60", to: "mass-30", locationId: "priest_house", activity: "准备弥撒" },
      { from: "mass-30", to: "mass+75", locationId: "church", activity: "主持弥撒" },
      { from: "mass+75", to: "noon+30", locationId: "green", activity: "在井边和教民说话，有点不自在" },
      { from: "noon+30", to: "vespers-30", locationId: "priest_house", activity: "读书" },
      { from: "vespers-30", to: "vespers+30", locationId: "church", activity: "念晚祷" },
      { from: "vespers+30", to: "curfew+60", locationId: "priest_house", activity: "在灯下读书" },
    ],
  },
  joan: {
    workday: [
      ...sleepAt("atwood_cottage", "dawn-30", "curfew"),
      { from: "dawn-30", to: "dawn+30", locationId: "atwood_cottage", activity: "喂鸡，挤羊奶" },
      { from: "dawn+30", to: "noon", locationId: "common", activity: "在公地上放鹅" },
      { from: "noon", to: "vespers", locationId: "mill", activity: "在磨坊帮工，扛面袋" },
      { from: "vespers", to: "vespers+60", locationId: "common", activity: "把鹅赶回来" },
      { from: "vespers+60", to: "curfew", locationId: "atwood_cottage", activity: "在家纺线" },
      { from: "vespers+60", to: "curfew", locationId: "alehouse", activity: "在玛蒂尔达家凑热闹", days: [6] },
    ],
    holyday: [
      ...sleepAt("atwood_cottage", "dawn", "curfew"),
      { from: "dawn", to: "mass-15", locationId: "atwood_cottage", activity: "喂鸡" },
      { from: "mass-15", to: "mass+60", locationId: "church", activity: "望弥撒，跟几个姑娘挤在一起" },
      { from: "mass+60", to: "vespers", locationId: "green", activity: "在井边闲逛，跟人说笑" },
      { from: "vespers", to: "curfew", locationId: "atwood_cottage", activity: "在家" },
    ],
  },
  hubert: {
    workday: [
      ...sleepAt("green_house", "dawn-60", "vespers+90"),
      { from: "dawn-60", to: "dawn+60", locationId: "green_house", activity: "坐在门口，等太阳出来" },
      { from: "dawn+60", to: "noon", locationId: "green", activity: "坐在井边的石凳上，看人来人往" },
      { from: "noon", to: "noon+60", locationId: "green_house", activity: "回家吃饭，儿媳没给好脸色" },
      { from: "noon+60", to: "vespers", locationId: "green", activity: "在井边晒太阳，逮着人就讲古" },
      { from: "vespers", to: "vespers+90", locationId: "alehouse", activity: "在玛蒂尔达家喝一杯，跟她斗嘴" },
    ],
    holyday: [
      ...sleepAt("green_house", "dawn-60", "vespers+90"),
      { from: "dawn-60", to: "mass-30", locationId: "green_house", activity: "穿上那件最好的外衣" },
      { from: "mass-30", to: "mass+60", locationId: "church", activity: "望弥撒，盯着神父哪一步做错了" },
      { from: "mass+60", to: "vespers", locationId: "green", activity: "在井边跟人讲从前的节日是怎么过的" },
      { from: "vespers", to: "vespers+90", locationId: "alehouse", activity: "在玛蒂尔达家喝一杯" },
    ],
  },
};

/** 开局时每个人手上有的东西（物品转移要先确认真的有）。 */
export const startingInventory: Record<string, Record<string, number>> = {
  matilda: { 麦酒: 12, 面包: 3, 苹果: 6 },
  thomas: { 面粉: 20, 面包: 4 },
  edmund: { 蜡烛: 10, 墨水: 1, 羊皮纸: 4, 面包: 2 },
  joan: { 鸡蛋: 6, 苹果: 4 },
  hubert: { 苹果: 3, 一块旧银币: 1 },
  player: { 羊皮纸: 20, 墨水: 3, 鹅毛笔: 4, 面包: 2 },
};
