// 开局时的人际关系（设定圣经 §7“人物之间的关系”）。有方向：from 怎么看 to。

import { PLAYER_ID, type Relationship } from "@elmsford/core";

export const relationships: Relationship[] = [
  { from: "matilda", to: "hubert", trust: 30, affection: 25, summary: "斗了几十年嘴的老冤家，他一开口她就要顶回去" },
  { from: "hubert", to: "matilda", trust: 35, affection: 30, summary: "跟她斗了一辈子嘴；年轻时那点事，谁也不提" },
  { from: "matilda", to: "thomas", trust: -20, affection: -5, summary: "认定他磨面克扣分量，逢人就说" },
  { from: "thomas", to: "matilda", trust: -10, affection: -10, summary: "她到处说他偷面，他懒得跟她争" },
  { from: "matilda", to: "edmund", trust: 40, affection: 30, summary: "常偷偷来喝两杯的小神父，她替他瞒着，也爱拿这事敲打他" },
  { from: "edmund", to: "matilda", trust: 45, affection: 25, summary: "只有在她那儿能喝上两杯不被人说闲话；有点怕她" },
  { from: "matilda", to: "joan", trust: 30, affection: 30, summary: "放鹅的丫头，嘴比她还快，倒不讨厌" },
  { from: "joan", to: "matilda", trust: 25, affection: 30, summary: "爱管闲事的老太太，村里的消息都从她那儿出来" },
  { from: "thomas", to: "joan", trust: 50, affection: 30, summary: "在磨坊帮工，手脚勤快，信得过" },
  { from: "joan", to: "thomas", trust: 45, affection: 20, summary: "话少的磨坊主，工钱从不少给" },
  { from: "thomas", to: "hubert", trust: 30, affection: 15, summary: "老庄头，敬着他，就是嫌他话多" },
  { from: "hubert", to: "thomas", trust: 15, affection: 10, summary: "磨坊主嘛，哪个磨坊主不偷两把面" },
  { from: "thomas", to: "edmund", trust: 55, affection: 30, summary: "神父年轻，书念得多；他敬重那身袍子" },
  { from: "edmund", to: "thomas", trust: 50, affection: 25, summary: "虔诚，可一句话都撬不出来" },
  { from: "hubert", to: "edmund", trust: 10, affection: 15, summary: "乳臭未干的孩子，礼拜的规矩都做不全" },
  { from: "edmund", to: "hubert", trust: 20, affection: 5, summary: "当众纠正他做礼拜，每次都让他下不来台" },
  { from: "hubert", to: "joan", trust: 30, affection: 35, summary: "阿特伍德家的丫头，肯停下来听他说两句" },
  { from: "joan", to: "hubert", trust: 30, affection: 30, summary: "爱讲古的老头，她学他说话能把人笑死" },
  { from: "joan", to: "edmund", trust: 30, affection: 15, summary: "年轻神父，说话绕，学他念拉丁文最好玩" },
  { from: "edmund", to: "joan", trust: 30, affection: 20, summary: "她说话太快，他常接不上；怀疑她背后学他" },

  // 对新来的抄写员：都还是生人。
  { from: "matilda", to: PLAYER_ID, trust: -5, affection: 0, summary: "新来的写字的，外乡人，先看着" },
  { from: "thomas", to: PLAYER_ID, trust: 0, affection: 0, summary: "还没打过交道" },
  { from: "edmund", to: PLAYER_ID, trust: 10, affection: 5, summary: "教堂的房客，识字的人" },
  { from: "joan", to: PLAYER_ID, trust: 0, affection: 5, summary: "新来的，看着不像干过活的" },
  { from: "hubert", to: PLAYER_ID, trust: 5, affection: 0, summary: "新来的写字的，没准用得上" },
];
