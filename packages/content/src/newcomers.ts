// 村里的人和外头来的人。人不多，免得记不住：
//   - 还没露面的村里人：种子里本来就提到的人（托马斯的老婆孩子、休伯特的儿子儿媳……）。平时不细说，
//     只在场景里露个面、在别人嘴里出现；谁被大家说起得多了，就走到台前，成了居民。
//   - 外头来的：按时节，有一定的可能。来不来、来的是谁，由规则和模型决定，不是剧情。
// 村里同时最多 MAX_RESIDENTS 个居民。

import type { Period, Routine } from "@elmsford/core";
import type { DailyEconomy } from "./economy";
import { sleepAt } from "./seeds/routines";

/** At most this many residents at once. */
export const MAX_RESIDENTS = 8;
/** A villager steps forward once they've come up this many times… */
export const MENTIONS_TO_STEP_FORWARD = 5;
/** …within this many days. */
export const MENTION_WINDOW_DAYS = 14;
/** And not sooner than this after the last one. */
export const STEP_FORWARD_GAP_DAYS = 14;

interface Seen {
  locationId: string;
  periods: Period[];
  text: string;
}

export interface FolkEntry {
  id: string;
  name: string;
  shortName: string;
  age: number;
  occupation: string;
  homeId: string;
  /** What the village knows about them; their seed is written from this. */
  sketch: string;
  /** What others call them, for counting how often they come up. */
  aliases: string[];
  /** Where you might catch sight of them before they step forward. */
  seen: Seen[];
  routine: Routine;
  economy: DailyEconomy;
  money: number;
  items: Record<string, number>;
}

export interface Opening {
  id: string;
  /** Who comes, for the model to make a person of. */
  sketch: string;
  ages: [number, number];
  occupation: string;
  homeId: string;
  /** Someone they lodge with, who gets to know them first. */
  hostId?: string;
  /** Grew up here: the older people may remember them. */
  familiar?: boolean;
  /** Inclusive "MM-DD" window, or whole months. */
  when: { from: string; to: string } | { months: number[] };
  chancePerDay: number;
  /** Days before someone like this comes again. */
  cooldownDays: number;
  /** [min, max] days they stay; without it, they stay for good. */
  stay?: [number, number];
  /** What the village hears. "{name}" is their short name. */
  announce: string;
  farewell?: string;
  routine: Routine;
  economy: DailyEconomy;
  money: number;
  items: Record<string, number>;
}

const DAY: Period[] = ["morning", "noon", "afternoon"];

export const folk: FolkEntry[] = [
  {
    id: "agnes",
    name: "艾格尼丝·韦尔",
    shortName: "艾格尼丝",
    age: 40,
    occupation: "磨坊主的妻子，操持一家子",
    homeId: "mill",
    sketch: "托马斯的妻子，四十岁上下。家里的事、两个小的、磨坊的账，她管着一半。托马斯憋着不说的话，她最先知道。",
    aliases: ["艾格尼丝"],
    seen: [
      { locationId: "mill", periods: ["morning", "afternoon"], text: "磨坊边上，艾格尼丝在晾衣服，两个小的围着她转。" },
      { locationId: "green", periods: ["noon"], text: "井边，艾格尼丝提着桶在等着打水。" },
    ],
    routine: {
      workday: [
        ...sleepAt("mill", "dawn-60", "curfew"),
        { from: "dawn-60", to: "noon-60", locationId: "mill", activity: "生火做饭，喂猪，看着两个小的" },
        { from: "noon-60", to: "noon", locationId: "green", activity: "在井边打水" },
        { from: "noon", to: "vespers", locationId: "mill", activity: "缝补衣裳，替托马斯记账" },
        { from: "vespers", to: "curfew", locationId: "mill", activity: "做晚饭，哄小的睡觉" },
      ],
      holyday: [
        ...sleepAt("mill", "dawn-30", "curfew"),
        { from: "dawn-30", to: "mass-30", locationId: "mill", activity: "给孩子们换上干净衣裳" },
        { from: "mass-30", to: "mass+75", locationId: "church", activity: "跟一家人望弥撒" },
        { from: "mass+75", to: "noon+30", locationId: "green", activity: "在井边跟几个女人说话" },
        { from: "noon+30", to: "curfew", locationId: "mill", activity: "在家" },
      ],
    },
    economy: { workday: [0, 1], holyday: [0, 0], spend: 1 },
    money: 20,
    items: { 面包: 2, 线团: 2 },
  },
  {
    id: "wat",
    name: "瓦特·韦尔",
    shortName: "瓦特",
    age: 17,
    occupation: "在磨坊给他爹帮工",
    homeId: "mill",
    sketch: "托马斯的大儿子，十七岁，力气大，心不在磨坊上，一心想去城里当学徒。对琼有好感，琼只把他当弟弟。",
    aliases: ["瓦特"],
    seen: [
      { locationId: "mill", periods: DAY, text: "瓦特扛着一袋麦子从磨坊里出来，肩膀上全是白面。" },
      { locationId: "ford", periods: ["evening"], text: "渡口的石阶上蹲着个后生，是瓦特，一块一块往河里扔石子。" },
    ],
    routine: {
      workday: [
        ...sleepAt("mill", "dawn-60", "curfew"),
        { from: "dawn-60", to: "noon", locationId: "mill", activity: "扛麦袋，过秤" },
        { from: "noon", to: "noon+30", locationId: "mill", activity: "在磨坊门口啃面包" },
        { from: "noon+30", to: "vespers", locationId: "mill", activity: "干活，眼睛老往路上瞟" },
        { from: "vespers", to: "vespers+60", locationId: "ford", activity: "在渡口坐一会儿" },
        { from: "vespers+60", to: "curfew", locationId: "mill", activity: "在家" },
        { from: "vespers+60", to: "curfew", locationId: "alehouse", activity: "在玛蒂尔达家跟几个后生凑在一块", days: [6] },
      ],
      holyday: [
        ...sleepAt("mill", "dawn-30", "curfew"),
        { from: "mass-30", to: "mass+75", locationId: "church", activity: "跟一家人望弥撒，站得离他爹远远的" },
        { from: "mass+75", to: "vespers", locationId: "green", activity: "在井边跟几个后生站在一块" },
        { from: "vespers", to: "curfew", locationId: "mill", activity: "在家" },
      ],
    },
    economy: { workday: [0, 1], holyday: [0, 0], spend: 0 },
    money: 3,
    items: { 面包: 1 },
  },
  {
    id: "roger",
    name: "罗杰·格林",
    shortName: "罗杰",
    age: 46,
    occupation: "种着格林家的地",
    homeId: "green_house",
    sketch: "休伯特的儿子，四十多岁，种着格林家的十几亩地。老实，不爱说话，夹在老爹和媳妇中间，两头不落好。",
    aliases: ["罗杰"],
    seen: [
      { locationId: "west_field", periods: DAY, text: "西田里，罗杰赶着两头牛在犁地，翻起来的泥黑油油的。" },
      { locationId: "green", periods: ["evening"], text: "罗杰扛着犁铧从井边走过，跟谁都只点一下头。" },
    ],
    routine: {
      workday: [
        ...sleepAt("green_house", "dawn-45", "curfew"),
        { from: "dawn-45", to: "noon", locationId: "west_field", activity: "在西田犁地、撒麦种" },
        { from: "noon", to: "noon+45", locationId: "west_field", activity: "坐在田埂上吃饭" },
        { from: "noon+45", to: "vespers", locationId: "west_field", activity: "接着犁地" },
        { from: "vespers", to: "curfew", locationId: "green_house", activity: "在家修农具" },
        { from: "vespers", to: "vespers+90", locationId: "alehouse", activity: "在玛蒂尔达家喝一罐", days: [6] },
      ],
      holyday: [
        ...sleepAt("green_house", "dawn-30", "curfew"),
        { from: "mass-30", to: "mass+60", locationId: "church", activity: "望弥撒" },
        { from: "mass+60", to: "noon+30", locationId: "green", activity: "在井边跟几个种地的说收成" },
        { from: "noon+30", to: "curfew", locationId: "green_house", activity: "在家歇着" },
      ],
    },
    economy: { workday: [2, 4], holyday: [0, 0], spend: 3 },
    money: 40,
    items: { 苹果: 4 },
  },
  {
    id: "alice",
    name: "爱丽丝·格林",
    shortName: "爱丽丝",
    age: 42,
    occupation: "操持格林家，养鸡、纺线",
    homeId: "green_house",
    sketch: "罗杰的妻子，休伯特的儿媳。手脚麻利，嘴不饶人，嫌老头子碍事，可老头子的饭一顿也没少过他的。",
    aliases: ["爱丽丝", "儿媳"],
    seen: [{ locationId: "green", periods: ["morning", "noon"], text: "爱丽丝在井边洗菜，跟人说话的声音老远就听得见。" }],
    routine: {
      workday: [
        ...sleepAt("green_house", "dawn-60", "curfew"),
        { from: "dawn-60", to: "dawn+60", locationId: "green_house", activity: "生火，喂鸡" },
        { from: "dawn+60", to: "noon", locationId: "green", activity: "在井边洗菜、洗衣裳" },
        { from: "noon", to: "vespers", locationId: "green_house", activity: "纺线，做饭" },
        { from: "vespers", to: "curfew", locationId: "green_house", activity: "收拾屋子" },
      ],
      holyday: [
        ...sleepAt("green_house", "dawn-30", "curfew"),
        { from: "mass-30", to: "mass+60", locationId: "church", activity: "望弥撒" },
        { from: "mass+60", to: "noon+30", locationId: "green", activity: "在井边跟人说长道短" },
        { from: "noon+30", to: "curfew", locationId: "green_house", activity: "在家" },
      ],
    },
    economy: { workday: [0, 1], holyday: [0, 0], spend: 1 },
    money: 12,
    items: { 鸡蛋: 4 },
  },
  {
    id: "margery",
    name: "玛格丽·阿特伍德",
    shortName: "玛格丽",
    age: 51,
    occupation: "茅舍农的寡妇，替人纺线、帮工",
    homeId: "atwood_cottage",
    sketch: "琼的娘，五十出头，男人前几年没了，一家子靠一块菜园、一群鹅和替人纺线过活。一门心思想让琼应了邻村那个有地的鳏夫。",
    aliases: ["玛格丽", "琼她娘", "琼的娘"],
    seen: [
      { locationId: "atwood_cottage", periods: DAY, text: "茅舍门口，玛格丽坐在小凳上纺线，线轴转个不停。" },
      { locationId: "common", periods: ["afternoon"], text: "公地边上，玛格丽弯着腰在拾柴。" },
    ],
    routine: {
      workday: [
        ...sleepAt("atwood_cottage", "dawn-30", "curfew"),
        { from: "dawn-30", to: "noon", locationId: "atwood_cottage", activity: "坐在门口纺线" },
        { from: "noon", to: "noon+45", locationId: "green", activity: "在井边打水" },
        { from: "noon+45", to: "vespers", locationId: "common", activity: "在公地边上拾柴" },
        { from: "vespers", to: "curfew", locationId: "atwood_cottage", activity: "在家，就着火光纺线" },
      ],
      holyday: [
        ...sleepAt("atwood_cottage", "dawn", "curfew"),
        { from: "mass-15", to: "mass+60", locationId: "church", activity: "望弥撒" },
        { from: "mass+60", to: "noon+30", locationId: "green", activity: "在井边跟人打听邻村的事" },
        { from: "noon+30", to: "curfew", locationId: "atwood_cottage", activity: "在家" },
      ],
    },
    economy: { workday: [1, 2], holyday: [0, 0], spend: 1 },
    money: 6,
    items: { 线团: 3 },
  },
  {
    id: "marsh",
    name: "杰弗里·马什",
    shortName: "马什",
    age: 52,
    occupation: "庄园的管家",
    homeId: "manor",
    sketch: "领主派来的管家，五十来岁，外乡人，识几个字，会算账。替领主收租、派工、管着磨坊和林子。不是坏人，只是从不替村里人说话。磨坊水轮轴的钱就卡在他手上。",
    aliases: ["马什", "管家"],
    seen: [
      { locationId: "manor", periods: DAY, text: "庄园门口，马什管家拿着一根刻着道道的记账木签，正跟人说着什么。" },
      { locationId: "manor_road", periods: ["noon", "afternoon"], text: "马什管家骑着一匹灰马，慢慢从路上过去，看着两边的田。" },
    ],
    routine: {
      workday: [
        ...sleepAt("manor", "dawn-30", "curfew+30"),
        { from: "dawn-30", to: "noon-60", locationId: "manor", activity: "在庄园里对账，刻记账木签" },
        { from: "noon-60", to: "noon+60", locationId: "manor_road", activity: "骑马看地，看谁家的活干得马虎" },
        { from: "noon+60", to: "vespers", locationId: "manor", activity: "在庄园里派工" },
        { from: "noon+60", to: "vespers", locationId: "mill", activity: "到磨坊对磨费的账", days: [2, 5] },
        { from: "vespers", to: "curfew+30", locationId: "manor", activity: "在庄园里吃饭、歇着" },
      ],
      holyday: [
        ...sleepAt("manor", "dawn-30", "curfew+30"),
        { from: "mass-30", to: "mass+60", locationId: "church", activity: "望弥撒，站在最前头" },
        { from: "mass+60", to: "curfew+30", locationId: "manor", activity: "在庄园里" },
      ],
    },
    economy: { workday: [3, 5], holyday: [3, 5], spend: 3 },
    money: 120,
    items: { 墨水: 1 },
  },
];

export const openings: Opening[] = [
  {
    id: "hired_hand",
    sketch: "外乡来的长工，男的，在金斯伯里圣马丁节的雇工集上被庄园雇下，一年为期，管吃住。瘟疫以后人手缺，工钱比从前高，领主不情愿也得出。",
    ages: [18, 35],
    occupation: "庄园雇的长工",
    homeId: "manor",
    when: { from: "11-09", to: "11-20" },
    chancePerDay: 0.25,
    cooldownDays: 300,
    announce: "庄园在金斯伯里的雇工集上雇了个长工，叫{name}，住进了庄园的下房。",
    routine: {
      workday: [
        ...sleepAt("manor", "dawn-60", "curfew"),
        { from: "dawn-60", to: "noon", locationId: "west_field", activity: "替庄园在西田撒麦种" },
        { from: "noon", to: "noon+30", locationId: "west_field", activity: "坐在田头吃饭" },
        { from: "noon+30", to: "vespers", locationId: "north_wood", activity: "在林子里替庄园砍柴" },
        { from: "vespers", to: "curfew", locationId: "manor", activity: "在下房里歇着" },
        { from: "vespers", to: "curfew", locationId: "alehouse", activity: "在玛蒂尔达家喝一罐，坐在角落里", days: [6] },
      ],
      holyday: [
        ...sleepAt("manor", "dawn-30", "curfew"),
        { from: "mass-30", to: "mass+60", locationId: "church", activity: "站在教堂后排，谁也不认识" },
        { from: "mass+60", to: "vespers", locationId: "green", activity: "在井边转悠" },
        { from: "vespers", to: "curfew", locationId: "alehouse", activity: "在玛蒂尔达家喝一罐" },
      ],
    },
    economy: { workday: [2, 3], holyday: [0, 0], spend: 1 },
    money: 10,
    items: { 面包: 1 },
  },
  {
    id: "tinker",
    sketch: "挑着担子走村串户的补锅匠，男的，补锅、磨刀、修锁，顺带捎些别处的消息。见多识广，嘴也碎，在一个地方待不了几天。",
    ages: [30, 60],
    occupation: "走村串户的补锅匠",
    homeId: "alehouse",
    hostId: "matilda",
    when: { months: [3, 4, 5, 6, 7, 8, 9, 10, 11] },
    chancePerDay: 0.03,
    cooldownDays: 40,
    stay: [5, 12],
    announce: "来了个补锅匠，叫{name}，在玛蒂尔达家借住几天。井边已经有人把破锅拿出来了。",
    farewell: "补锅匠{name}挑着担子走了，往下一个村子去了。",
    routine: {
      workday: [
        ...sleepAt("alehouse", "dawn-30", "curfew+30"),
        { from: "dawn-30", to: "dawn+30", locationId: "alehouse", activity: "在玛蒂尔达家喝口热汤" },
        { from: "dawn+30", to: "noon", locationId: "green", activity: "在井边摆开担子，补锅磨刀" },
        { from: "noon", to: "noon+60", locationId: "alehouse", activity: "在玛蒂尔达家吃饭" },
        { from: "noon+60", to: "vespers", locationId: "green", activity: "接着补锅，跟围着看的人闲扯" },
        { from: "vespers", to: "curfew+30", locationId: "alehouse", activity: "在玛蒂尔达家喝酒，讲外头的事" },
      ],
      holyday: [
        ...sleepAt("alehouse", "dawn", "curfew+30"),
        { from: "mass-15", to: "mass+60", locationId: "church", activity: "站在教堂门口看人" },
        { from: "mass+60", to: "vespers", locationId: "green", activity: "在井边跟人闲扯，不干活" },
        { from: "vespers", to: "curfew+30", locationId: "alehouse", activity: "在玛蒂尔达家喝酒" },
      ],
    },
    economy: { workday: [2, 5], holyday: [0, 1], spend: 2 },
    money: 30,
    items: { 针: 20, 小刀: 2, 面包: 1 },
  },
  {
    id: "heir",
    sketch: "回村认地的女人。瘟疫那年一家人死得只剩下她，那时她在外村帮佣。如今回来，要认下巷子里那间空屋和她爹种过的地，先得给领主交一笔入地钱。",
    ages: [24, 40],
    occupation: "回村认地的人",
    homeId: "lane",
    familiar: true,
    when: { months: [3, 4, 5, 9, 10, 11] },
    chancePerDay: 0.015,
    cooldownDays: 100_000,
    announce: "{name}回村了。巷子里那间空了十几年的屋子，是她家原先的。她说是回来认地的。",
    routine: {
      workday: [
        ...sleepAt("lane", "dawn-30", "curfew"),
        { from: "dawn-30", to: "noon", locationId: "lane", activity: "收拾屋子，补屋顶的窟窿" },
        { from: "noon", to: "noon+60", locationId: "green", activity: "在井边打水，跟人打听从前的事" },
        { from: "noon+60", to: "vespers", locationId: "south_field", activity: "去看她爹从前种的那块地" },
        { from: "vespers", to: "curfew", locationId: "lane", activity: "在家" },
      ],
      holyday: [
        ...sleepAt("lane", "dawn-30", "curfew"),
        { from: "mass-30", to: "mass+60", locationId: "church", activity: "望弥撒" },
        { from: "mass+60", to: "noon+60", locationId: "churchyard", activity: "在墓园里找家里人的坟" },
        { from: "noon+60", to: "curfew", locationId: "lane", activity: "在家" },
      ],
    },
    economy: { workday: [0, 2], holyday: [0, 0], spend: 1 },
    money: 45,
    items: { 面包: 2 },
  },
];

/** Whether a date ("YYYY-MM-DD") falls in an opening's window. */
export function inSeason(o: Opening, date: string): boolean {
  if ("months" in o.when) return o.when.months.includes(Number(date.slice(5, 7)));
  const md = date.slice(5);
  return o.when.from <= o.when.to ? md >= o.when.from && md <= o.when.to : md >= o.when.from || md <= o.when.to;
}
