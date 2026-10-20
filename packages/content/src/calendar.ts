// Elmsford 的历法：节日、斋期、钟声和农事（设定圣经 §3.5、§3.6）。
// 大体照 14 世纪英格兰堂区的历法排；日期对应现实的公历。

import type { CalendarData, FeastDef } from "@elmsford/core";

const fixed = (month: number, day: number, def: Omit<FeastDef, "rule">, leapDay?: number): FeastDef => ({
  ...def,
  rule: { kind: "fixed", month, day, ...(leapDay ? { leapDay } : {}) },
});

const easter = (offset: number, def: Omit<FeastDef, "rule">): FeastDef => ({
  ...def,
  rule: { kind: "easter", offset },
});

const FEASTS: FeastDef[] = [
  // 一月
  fixed(1, 1, { id: "circumcision", name: "主受割礼节", rank: "major", holyDay: true }),
  fixed(1, 6, { id: "epiphany", name: "主显节", rank: "principal", holyDay: true, fastingEve: true, note: "圣诞十二日的最后一天" }),
  { id: "plough_monday", name: "犁地星期一", rank: "minor", rule: { kind: "weekdayAfter", month: 1, day: 6, weekday: 1 }, note: "年轻人拖着犁挨家讨钱，节一过就该下地了" },
  fixed(1, 13, { id: "hilary", name: "圣希拉里节", rank: "minor" }),
  fixed(1, 20, { id: "fabian_sebastian", name: "圣法比盎与圣塞巴斯蒂安节", rank: "minor" }),
  fixed(1, 21, { id: "agnes", name: "圣阿格尼丝节", rank: "minor", note: "前一晚姑娘们不吃晚饭，据说能梦见将来的丈夫" }),
  fixed(1, 25, { id: "conversion_paul", name: "圣保罗归信节", rank: "major" }),
  // 二月
  fixed(2, 2, { id: "candlemas", name: "圣烛节", rank: "major", holyDay: true, fastingEve: true, note: "教堂里祝圣蜡烛，人人举着蜡烛进去" }),
  fixed(2, 3, { id: "blaise", name: "圣布莱斯节", rank: "minor", note: "神父拿两支交叉的蜡烛抵着人的喉咙祝福" }),
  fixed(2, 5, { id: "agatha", name: "圣阿加莎节", rank: "minor" }),
  fixed(2, 14, { id: "valentine", name: "圣瓦伦丁节", rank: "minor", note: "都说鸟儿这天开始配对" }),
  fixed(2, 24, { id: "matthias", name: "圣马提亚节", rank: "major", holyDay: true, fastingEve: true }, 25),
  // 三月
  fixed(3, 1, { id: "david", name: "圣大卫节", rank: "minor" }),
  fixed(3, 12, { id: "gregory", name: "圣格列高利节", rank: "minor" }),
  fixed(3, 20, { id: "cuthbert", name: "圣卡斯伯特节", rank: "minor" }),
  fixed(3, 21, { id: "benedict", name: "圣本笃节", rank: "minor" }),
  fixed(3, 25, { id: "lady_day", name: "天使报喜节", rank: "major", holyDay: true, note: "季度结账日，该交的租和工钱在这天算清" }),
  // 四月
  fixed(4, 23, { id: "george", name: "圣乔治节", rank: "minor" }),
  fixed(4, 25, { id: "mark", name: "圣马可节", rank: "minor", note: "大祈祷日，人们跟着十字架绕田游行" }),
  // 五月
  fixed(5, 1, { id: "philip_james", name: "圣腓力与圣雅各节", rank: "major", holyDay: true, fastingEve: true, note: "五朔节，年轻人天不亮就去林子里折花枝" }),
  fixed(5, 3, { id: "invention_cross", name: "寻获十字架节", rank: "major", holyDay: true }),
  fixed(5, 19, { id: "dunstan", name: "圣邓斯坦节", rank: "minor" }),
  fixed(5, 26, { id: "augustine", name: "坎特伯雷的圣奥古斯丁节", rank: "minor" }),
  // 六月
  fixed(6, 11, { id: "barnabas", name: "圣巴拿巴节", rank: "minor" }),
  fixed(6, 24, { id: "john_baptist", name: "施洗约翰诞辰节", rank: "major", holyDay: true, fastingEve: true, note: "仲夏，季度结账日；前一晚家家门口点篝火" }),
  fixed(6, 29, { id: "peter_paul", name: "圣彼得与圣保罗节", rank: "major", holyDay: true, fastingEve: true }),
  // 七月
  fixed(7, 7, { id: "translation_becket", name: "圣托马斯遗骨迁移节", rank: "major", holyDay: true }),
  fixed(7, 15, { id: "swithun", name: "圣斯威森节", rank: "minor", note: "老话说这天下雨，就要接着下四十天" }),
  fixed(7, 20, { id: "margaret", name: "圣玛格丽特节", rank: "major", holyDay: true, fastingEve: true, note: "本村教堂的主保圣人节，全村都要来" }),
  fixed(7, 22, { id: "mary_magdalene", name: "抹大拉的圣马利亚节", rank: "major", holyDay: true }),
  fixed(7, 25, { id: "james", name: "圣雅各节", rank: "major", holyDay: true, fastingEve: true }),
  fixed(7, 26, { id: "anne", name: "圣安妮节", rank: "minor" }),
  // 八月
  fixed(8, 1, { id: "lammas", name: "收获节", rank: "major", note: "用新麦烤的头一个面包送到教堂祝圣" }),
  fixed(8, 6, { id: "transfiguration", name: "主显圣容节", rank: "minor" }),
  fixed(8, 10, { id: "lawrence", name: "圣劳伦斯节", rank: "major", holyDay: true, fastingEve: true }),
  fixed(8, 15, { id: "assumption", name: "圣母升天节", rank: "principal", holyDay: true, fastingEve: true }),
  fixed(8, 24, { id: "bartholomew", name: "圣巴多罗买节", rank: "major", holyDay: true, fastingEve: true }),
  fixed(8, 29, { id: "beheading_john", name: "施洗约翰殉道节", rank: "minor" }),
  // 九月
  fixed(9, 8, { id: "nativity_mary", name: "圣母诞辰节", rank: "major", holyDay: true }),
  fixed(9, 14, { id: "holy_cross", name: "举荣十字架节", rank: "major", holyDay: true }),
  fixed(9, 21, { id: "matthew", name: "圣马太节", rank: "major", holyDay: true, fastingEve: true }),
  fixed(9, 29, { id: "michaelmas", name: "圣米迦勒节", rank: "major", holyDay: true, note: "季度结账日，庄园算一年的账，选新的庄头" }),
  // 十月
  fixed(10, 9, { id: "denis", name: "圣德尼节", rank: "minor" }),
  fixed(10, 13, { id: "edward_confessor", name: "忏悔者圣爱德华节", rank: "minor" }),
  fixed(10, 18, { id: "luke", name: "圣路加节", rank: "major", holyDay: true }),
  fixed(10, 21, { id: "ursula", name: "圣乌苏拉与一万一千贞女节", rank: "minor" }),
  fixed(10, 25, { id: "crispin", name: "圣克里斯平节", rank: "minor", note: "鞋匠的节" }),
  fixed(10, 28, { id: "simon_jude", name: "圣西门与圣犹大节", rank: "major", holyDay: true, fastingEve: true }),
  // 十一月
  fixed(11, 1, { id: "all_saints", name: "诸圣节", rank: "principal", holyDay: true, fastingEve: true }),
  fixed(11, 2, { id: "all_souls", name: "万灵节", rank: "major", note: "为死者祈祷，墓园里点起蜡烛" }),
  fixed(11, 6, { id: "leonard", name: "圣伦纳德节", rank: "minor" }),
  fixed(11, 11, { id: "martinmas", name: "圣马丁节", rank: "major", note: "杀猪腌肉，交租，喝新酒" }),
  fixed(11, 20, { id: "edmund_martyr", name: "殉道者圣埃德蒙节", rank: "minor" }),
  fixed(11, 23, { id: "clement", name: "圣克莱门特节", rank: "minor", note: "铁匠的节" }),
  fixed(11, 25, { id: "catherine", name: "圣凯瑟琳节", rank: "minor", note: "纺线的女人们的节" }),
  fixed(11, 30, { id: "andrew", name: "圣安德烈节", rank: "major", holyDay: true, fastingEve: true }),
  { id: "advent_sunday", name: "将临期第一主日", rank: "major", rule: { kind: "advent", offset: 0 } },
  // 十二月
  fixed(12, 6, { id: "nicholas", name: "圣尼古拉节", rank: "major", holyDay: true, note: "孩子里选一个当一天的小主教" }),
  fixed(12, 8, { id: "conception_mary", name: "圣母始孕节", rank: "major", holyDay: true }),
  fixed(12, 13, { id: "lucy", name: "圣露西节", rank: "minor" }),
  fixed(12, 21, { id: "thomas_apostle", name: "使徒圣多马节", rank: "major", holyDay: true, fastingEve: true }),
  fixed(12, 25, { id: "christmas", name: "圣诞节", rank: "principal", holyDay: true, fastingEve: true, note: "圣诞十二日开始，一年里最长的假" }),
  fixed(12, 26, { id: "stephen", name: "圣司提反节", rank: "major", holyDay: true }),
  fixed(12, 27, { id: "john_evangelist", name: "使徒圣约翰节", rank: "major", holyDay: true }),
  fixed(12, 28, { id: "innocents", name: "诸圣婴孩节", rank: "major", holyDay: true }),
  fixed(12, 29, { id: "becket", name: "圣托马斯·贝克特节", rank: "major", holyDay: true }),

  // 跟着复活节走的节日
  easter(-63, { id: "septuagesima", name: "七旬主日", rank: "minor" }),
  easter(-47, { id: "shrove_tuesday", name: "忏悔星期二", rank: "major", note: "大斋前最后一天，吃煎饼，斗鸡，踢球" }),
  easter(-46, { id: "ash_wednesday", name: "圣灰星期三", rank: "major", note: "大斋开始，神父在人额头上抹灰" }),
  easter(-7, { id: "palm_sunday", name: "圣枝主日", rank: "major", note: "举着柳枝绕教堂游行" }),
  easter(-3, { id: "maundy_thursday", name: "濯足星期四", rank: "major" }),
  easter(-2, { id: "good_friday", name: "耶稣受难日", rank: "principal" }),
  easter(0, { id: "easter", name: "复活节", rank: "principal", holyDay: true, note: "大斋结束，又能吃肉和鸡蛋了" }),
  easter(1, { id: "easter_monday", name: "复活节星期一", rank: "minor", holyDay: true }),
  easter(2, { id: "easter_tuesday", name: "复活节星期二", rank: "minor", holyDay: true }),
  easter(9, { id: "hock_tuesday", name: "霍克星期二", rank: "minor", note: "拦路绑人讨钱，钱归教堂" }),
  easter(36, { id: "rogation", name: "祈祷日", rank: "minor", note: "一连三天跟着神父绕村界走，为庄稼祈祷" }),
  easter(39, { id: "ascension", name: "耶稣升天节", rank: "major", holyDay: true, fastingEve: true }),
  easter(49, { id: "pentecost", name: "圣灵降临节", rank: "principal", holyDay: true, fastingEve: true }),
  easter(50, { id: "whit_monday", name: "圣灵降临节星期一", rank: "minor", holyDay: true, note: "教堂酿的麦酒拿出来卖，钱归教堂" }),
  easter(56, { id: "trinity", name: "圣三一主日", rank: "major" }),
  easter(60, { id: "corpus_christi", name: "基督圣体节", rank: "major", holyDay: true, note: "抬着圣体游行" }),
];

export const calendar: CalendarData = {
  feasts: FEASTS,
  emberAnchors: [
    { kind: "easter", offset: -42 }, // 大斋第一主日
    { kind: "easter", offset: 49 }, // 圣灵降临节
    { kind: "fixed", month: 9, day: 14 }, // 举荣十字架节
    { kind: "fixed", month: 12, day: 13 }, // 圣露西节
  ],
  seasonNames: {
    advent: "将临期",
    christmastide: "圣诞十二日",
    epiphany: "主显节后",
    septuagesima: "大斋前",
    lent: "大斋期",
    eastertide: "复活期",
    trinity: "圣三一后",
  },
  fastReasonNames: {
    friday: "星期五",
    lent: "大斋期",
    ember: "四季斋日",
    vigil: "前夕",
  },
  bellNames: {
    dawn: "晨钟",
    mass: "弥撒钟",
    noon: "午钟",
    vespers: "晚祷钟",
    curfew: "熄火钟",
  },
  periodNames: {
    deep_night: "深夜",
    dawn: "黎明",
    morning: "上午",
    noon: "正午",
    afternoon: "下午",
    evening: "傍晚",
    night: "入夜",
  },
  weekdayNames: ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"],
  agrarianByMonth: [
    ["修篱笆", "挖沟", "砍柴（得有领主的许可）", "纺线"],
    ["修农具", "母羊下羔", "清沟渠"],
    ["春耕", "播豆子、燕麦和大麦"],
    ["春播收尾", "耙地", "赶鸟", "牲口赶到草场上"],
    ["给冬麦除草", "翻休耕地", "放牧"],
    ["剪羊毛", "草场开镰割干草"],
    ["晒干草、堆草垛", "休耕地再翻一遍"],
    ["收麦", "捆麦子", "拾穗"],
    ["收割收尾", "打谷", "摘果子", "把猪赶进林子吃橡子"],
    ["秋耕", "播冬麦", "摘苹果", "酿苹果酒"],
    ["杀猪腌肉", "交租", "打谷"],
    ["修补农具", "纺线", "喂牲口过冬"],
  ],
};
