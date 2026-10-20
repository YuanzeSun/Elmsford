// 世界摩擦表（技术设计 §4.5）：村子太静的时候，导演从这里抽“可能发生的事”。
// 每一条只是一件事，不是剧情；之后谁怎么应对，由他们自己决定。

import type { FrictionDef } from "@elmsford/core";

const WINTER = [11, 12, 1, 2];
const AUTUMN_WINTER = [10, 11, 12, 1, 2, 3];

export const frictionTable: FrictionDef[] = [
  // 生病
  { id: "chill", text: "{name}着了凉，咳嗽，身上发冷", weight: 5, target: "anyone", months: AUTUMN_WINTER, cooldownDays: 10, visibility: "public", effect: { health: -22, concern: "咳嗽，身上发冷" } },
  { id: "fever", text: "{name}发起了烧，躺下了", weight: 2, target: "anyone", cooldownDays: 20, visibility: "public", effect: { health: -35, concern: "发烧，起不来床" } },
  { id: "joints", text: "{name}的关节疼得厉害，手指伸不直", weight: 3, target: "elderly", maxTempC: 10, cooldownDays: 7, visibility: "target", effect: { health: -8, concern: "关节疼" } },
  { id: "fall", text: "{name}在湿泥地上滑了一跤，扭了脚", weight: 2, target: "anyone", cooldownDays: 20, visibility: "public", effect: { health: -15, concern: "脚扭了，走路一瘸一拐" } },
  { id: "toothache", text: "{name}牙疼，半边脸肿了", weight: 2, target: "anyone", cooldownDays: 30, visibility: "public", effect: { health: -6, concern: "牙疼" } },

  // 东西坏了
  { id: "roof_leak", text: "夜里下雨，你那间屋子的屋顶漏了，地上一摊水", weight: 2, cooldownDays: 25, visibility: "public", months: AUTUMN_WINTER, effect: { weather: { sky: "rain", text: "夜里下了一场大雨，早上还没停。" } } },
  { id: "mill_wheel", text: "磨坊的水轮又出了毛病，转起来咯吱咯吱响", weight: 2, target: ["thomas"], cooldownDays: 14, visibility: "public", effect: { concern: "水轮又出毛病了" } },
  { id: "brew_sour", text: "{name}有一桶酒酸了，倒也不是，卖也不是", weight: 2, target: ["matilda"], cooldownDays: 14, visibility: "target", effect: { item: { name: "麦酒", qty: -4, owner: "target" }, concern: "一桶酒酸了" } },
  { id: "goose_lost", text: "{name}放的鹅少了一只，找了半天没找着", weight: 2, target: ["joan"], cooldownDays: 20, visibility: "public", effect: { concern: "少了一只鹅" } },
  { id: "candles_short", text: "教堂的蜡烛快用完了，{name}点了点，不够撑到下个节日", weight: 1, target: ["edmund"], cooldownDays: 30, visibility: "target", effect: { item: { name: "蜡烛", qty: -6, owner: "target" }, concern: "蜡烛不够了" } },

  // 天气
  { id: "storm", text: "夜里起了大风，吹倒了井边的一棵老树", weight: 1, cooldownDays: 30, visibility: "public", months: AUTUMN_WINTER, effect: { weather: { sky: "storm", text: "夜里刮了一夜大风，早上风还没停，路上全是断树枝。" } } },
  { id: "first_snow", text: "下了今冬第一场雪", weight: 2, cooldownDays: 60, visibility: "public", months: WINTER, maxTempC: 3, effect: { weather: { sky: "snow", text: "下雪了，屋顶和墓园都白了。" } } },
  { id: "flood", text: "埃尔河涨水，渡口过不去了", weight: 1, cooldownDays: 30, visibility: "public", months: [11, 12, 1, 2, 3], effect: { weather: { sky: "rain", text: "连着下雨，河水涨到了渡口的石阶上。" } } },
  { id: "clear_day", text: "难得一个好天，太阳晒得人想脱外衣", weight: 2, cooldownDays: 10, visibility: "public", effect: { weather: { sky: "clear", text: "难得的晴天，天很高，太阳晒在背上暖烘烘的。" } } },

  // 外面来的
  { id: "peddler", text: "一个挑担子的货郎进了村，在井边摊开针线、缎带和小刀", weight: 2, cooldownDays: 10, visibility: "public", effect: {} },
  { id: "bailiff", text: "庄园的管家派人来，说领主要加征一笔修路的钱，每户两便士", weight: 1, cooldownDays: 30, visibility: "public", effect: {} },
  { id: "news_town", text: "从金斯伯里回来的人带来消息：镇上有人得了怪病，死了两个", weight: 1, cooldownDays: 40, visibility: "public", effect: {} },
  { id: "stray_dog", text: "一条瘦狗跟着人进了村，在墓园边上转来转去", weight: 1, cooldownDays: 30, visibility: "public", effect: {} },
  { id: "wedding_next_village", text: "邻村有人办婚事，请了这边的人去喝酒", weight: 1, cooldownDays: 30, visibility: "public", effect: {} },
  { id: "pig_loose", text: "谁家的猪跑了出来，拱翻了{name}的菜园", weight: 1, target: ["joan", "hubert"], cooldownDays: 20, visibility: "public", effect: { concern: "菜园被猪拱了" } },
];
