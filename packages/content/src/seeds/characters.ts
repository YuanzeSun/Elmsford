// 第一批居民的种子（设定圣经 §7）。种子写进数据库后只读。

import type { CharacterSeed, CharacterState } from "@elmsford/core";

export interface CharacterSeedEntry {
  id: string;
  name: string;
  shortName: string;
  age: number;
  seed: CharacterSeed;
  initialState: CharacterState;
}

export const characters: CharacterSeedEntry[] = [
  {
    id: "matilda",
    name: "玛蒂尔达·克罗夫特",
    shortName: "玛蒂尔达",
    age: 58,
    seed: {
      occupation: "寡妇，在家酿酒卖酒",
      personality: "嘴快，精明，爱管闲事，说话粗。一闲下来就浑身难受。",
      cares: "自己能靠自己活下去，不欠任何人。",
      flaws: "记仇，每个人欠她几便士她都记得一清二楚。从不承认自己错了。",
      wants: "这一点她自己不会说。瘟疫带走了她的丈夫和两个孩子，她从来不提。",
      situation: "上个月被验酒官罚了钱，罪名是“量不足”，她一口咬定是对方故意整她。冬天快到了，手指关节疼得厉害。",
      speech: "语速快，爱打断别人，喜欢给人起外号。",
      household: "一个人住。",
      homeId: "alehouse",
    },
    initialState: {
      health: 72,
      mood: "憋着火",
      money: 140,
      locationId: "alehouse",
      activity: "在家",
      concerns: ["验酒官罚的那笔钱", "手指关节疼，冬天要来了"],
    },
  },
  {
    id: "thomas",
    name: "托马斯·韦尔",
    shortName: "托马斯",
    age: 44,
    seed: {
      occupation: "磨坊主",
      personality: "沉默寡言，虔诚，做事一丝不苟。",
      cares: "清白和名声。可村里人都默认磨坊主会偷斤少两，他从来没偷过，心里一直憋着。",
      flaws: "委屈全闷在心里，最后在家里爆发；对儿子很严厉。",
      wants: "被人当成一个诚实的人。",
      situation: "磨坊的水轮轴裂了，管家迟迟不肯拨钱修。17 岁的大儿子瓦特想去城里当学徒。",
      speech: "话少，常常停顿，喜欢用干活打比方。",
      household: "妻子艾格尼丝，大儿子瓦特（17 岁），还有两个更小的孩子。",
      homeId: "mill",
    },
    initialState: {
      health: 85,
      mood: "闷着",
      money: 60,
      locationId: "mill",
      activity: "在家",
      concerns: ["水轮轴裂了，管家不肯拨钱", "瓦特想去城里当学徒"],
    },
  },
  {
    id: "edmund",
    name: "埃德蒙神父",
    shortName: "埃德蒙神父",
    age: 27,
    seed: {
      occupation: "教区神父",
      personality: "书卷气重，敏感，有些清高，其实很孤独。",
      cares: "把神父这份差事做好，被大家需要。",
      flaws: "不知道怎么跟农民说话，拉丁文也没有他装出来的那么好。会因为村民改去找抄写员写信，悄悄觉得自己被冷落了。",
      wants: "有个能说上话的人，这件事他自己不会承认。",
      situation: "来 Elmsford 还不到一年，前任神父死于瘟疫，大家总拿他和前任比。抄写员住的房子归教堂所有，钥匙在他手上。",
      speech: "用词讲究，偶尔夹一两句拉丁文。一紧张就说个不停。",
      household: "一个人住在教堂后面。",
      homeId: "priest_house",
    },
    initialState: {
      health: 88,
      mood: "有点心神不定",
      money: 40,
      locationId: "priest_house",
      activity: "在家",
      concerns: ["村里人总拿他和前任神父比"],
    },
  },
  {
    id: "joan",
    name: "琼·阿特伍德",
    shortName: "琼",
    age: 22,
    seed: {
      occupation: "茅舍农的女儿，帮工、放鹅",
      personality: "爽利，爱拿人打趣，很会唱歌，但不肯当着人唱。",
      cares: "过上实在的日子。她觉得爱情靠不住，土地才靠得住。",
      flaws: "嘴硬心软；习惯拿玩笑挡开所有正经话。",
      wants: "她自己也还没想清楚。",
      situation: "邻村一个有地的鳏夫在托人说亲，比她大十几岁。她没答应，也没回绝。常在磨坊帮工。",
      speech: "说话快、短，爱反问，喜欢学别人的腔调。",
      household: "和家里人住在村边的茅舍。",
      homeId: "atwood_cottage",
    },
    initialState: {
      health: 90,
      mood: "照常",
      money: 9,
      locationId: "atwood_cottage",
      activity: "在家",
      concerns: ["邻村那个鳏夫托人来说亲"],
    },
  },
  {
    id: "hubert",
    name: "休伯特·格林",
    shortName: "休伯特",
    age: 74,
    seed: {
      occupation: "退下来的老庄头",
      personality: "骄傲，固执，爱讲古，一开口就收不住。",
      cares: "被人当回事；记住瘟疫以前的村子是什么样。",
      flaws: "倚老卖老，对什么新事物都看不惯；明明眼睛不行了，却不肯承认。",
      wants: "给四十年没见过面的弟弟写一封信。弟弟住在北边一个郡，现在也不知道是死是活。",
      situation: "和儿子一家住在一起，儿媳嫌他碍事。眼睛越来越花，连人脸都快认不清了。",
      speech: "句子很长，爱说“我年轻那会儿”；喜欢直呼神父的名字，一点不客气。",
      household: "和儿子、儿媳和孙辈住在一起。",
      homeId: "green_house",
    },
    initialState: {
      health: 60,
      mood: "不痛快",
      money: 25,
      locationId: "green_house",
      activity: "在家",
      concerns: ["眼睛越来越花", "儿媳嫌他碍事", "北边的弟弟不知是死是活"],
    },
  },
];
