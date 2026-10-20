// 老规矩：一年里的节日、斋期、钟声，对村里人意味着什么。
//
// 这些从不直接讲给玩家听。signs 是玩家在村里能看到、听到的样子；lore 和 personal 给村民和
// 规划用，村民只说自己为这些日子要做什么、想到谁；玩家问起，他们才用自己的话讲。讲过的，
// 记进笔记本。

import type { Custom } from "@elmsford/core";

const OUTDOORS = ["green", "churchyard", "ford", "common", "manor_road", "meadow", "east_field", "west_field", "south_field"];
const HOMES = ["green_house", "atwood_cottage", "mill", "alehouse"];
const FIELDS = ["east_field", "west_field", "south_field", "manor_road", "common"];

export const customs: Custom[] = [
  // ---------------------------------------------------------------- 秋
  {
    key: "luke",
    name: "圣路加节",
    when: { feast: "luke" },
    lore: "写福音的路加的节日，他也是医生和画匠的圣人。老话说圣路加节前后总有几天暖和日子，叫“路加的小夏天”，过了就该冷了。",
    personal: {
      hubert: "他记得哪一年的路加小夏天最长，那年收成也好。",
    },
    signs: [{ at: ["green"], days: [0, 3], text: "井边有人说，路加的小夏天撑不了几天了。" }],
  },
  {
    key: "simon_jude",
    name: "圣西门与圣犹大节",
    when: { feast: "simon_jude" },
    lore: "使徒西门和犹大（不是出卖耶稣的那个）的节日，要望弥撒。老话说过了这天，天就要变坏，秋耕得赶在前头。",
    personal: {
      edmund: "他得讲道，却总想不出关于这两位使徒该讲些什么。",
      thomas: "过了这天雨水多，河水一涨，水轮那道裂口更叫他担心。",
    },
    signs: [
      { at: FIELDS, days: [-3, -1], text: "田里的人赶着牛犁地，比前几天起得更早。" },
      { at: ["church"], text: "门廊下站着几个人，在跺鞋上的泥，等着望弥撒。" },
    ],
  },
  {
    key: "all_saints",
    name: "诸圣节",
    when: { feast: "all_saints" },
    lore: "敬一切圣人的大节，要望弥撒，不干活。前一晚是诸圣节前夕，晚祷以后教堂要为死去的人敲很久的钟。",
    personal: {
      edmund: "前一晚他得守在钟楼下，看着敲钟的人别偷懒。",
    },
    signs: [
      { days: [-1, -1], periods: ["evening", "night"], text: "教堂的钟一直在敲，慢慢的，一下，一下，敲了很久。" },
      { at: ["church"], text: "教堂里点满了蜡烛，比平常亮得多。" },
    ],
  },
  {
    key: "all_souls",
    name: "万灵节",
    when: { feast: "all_souls" },
    lore: "为所有死去的人祈祷的日子。人们到墓园给亲人的坟点蜡烛；家里烙“灵魂饼”，分给上门讨的孩子和穷人，换他们替死者念一句祷文。",
    personal: {
      matilda: "瘟疫带走了她丈夫和两个孩子。她会去墓园点三支蜡烛，不跟任何人说。",
      hubert: "他要去墓园，给瘟疫那年死的人点蜡烛，一个个念名字，念着念着就记不清了。",
      edmund: "前任神父埋在墓园里。大家点蜡烛时，总在那座坟前多站一会儿，他看在眼里。",
      thomas: "他领着一家人去，站得笔直，一句话也不说。",
      joan: "她家也有人死在瘟疫里。那时她还小，记不清脸了。",
    },
    signs: [
      { at: ["green", "atwood_cottage", "green_house"], days: [-1, 0], periods: ["afternoon", "evening"], text: "几个孩子挨家敲门，嘴里念着讨饼的歌。" },
      { at: ["churchyard"], periods: ["morning", "noon", "afternoon"], text: "有人跪在一座新坟边上，膝盖底下垫着一块麻布。" },
      { at: ["churchyard"], periods: ["evening", "night", "deep_night"], text: "坟头上点着一支支小蜡烛。风一吹，火苗都朝一边倒。" },
      { at: ["player_house"], periods: ["evening", "night"], text: "窗外墓园那边亮着星星点点的火。" },
    ],
  },
  {
    key: "martinmas",
    name: "圣马丁节",
    when: { feast: "martinmas" },
    lore: "冬天从圣马丁节算起。猪养肥了就杀，肉腌起来过冬；佃户这天交租；新酿的酒开封。雇工也在这天换东家、算工钱。",
    personal: {
      thomas: "管家要来算磨坊这一年的账。",
      joan: "她家那头猪是她从小喂大的，要杀了。",
      matilda: "新酒开封，是她一年里最忙、进钱最多的几天。",
      hubert: "他做庄头那些年，收租是他的差事，哪家欠过什么他都记得。",
    },
    signs: [
      { days: [-3, -1], text: "谁家在磨刀，石头上吱吱地响。" },
      { at: ["atwood_cottage", "green_house"], days: [-2, -1], text: "猪圈里的猪叫得厉害，像是知道了什么。" },
      { at: OUTDOORS, text: "空气里有股血腥气，混着烧猪毛的焦味。" },
      { at: ["alehouse"], days: [0, 1], text: "门口摆出了一桶新酒，桶上用白灰画了个十字。" },
      { at: ["manor"], text: "庄园门口排着交租的人，有的提着鸡，有的背着粮袋。" },
    ],
  },
  {
    key: "catherine",
    name: "圣凯瑟琳节",
    when: { feast: "catherine" },
    lore: "纺线织布的女人们的节日。凯瑟琳是死在轮子上的圣女，所以纺车也归她管。这天女人们凑在一起纺线、吃喝、唱歌。",
    personal: {
      joan: "她会跟几个姑娘凑在一起纺线唱歌，只在屋里，没有外人的时候。",
      matilda: "她年轻时也去纺线的屋里凑过热闹，如今只说那是小姑娘的事。",
    },
    signs: [{ at: ["atwood_cottage"], periods: ["afternoon", "evening"], text: "屋里传出纺车的嗡嗡声，有人跟着哼歌，听见脚步声就停了。" }],
  },
  // ---------------------------------------------------------------- 冬
  {
    key: "advent",
    name: "将临期",
    when: { season: "advent" },
    lore: "圣诞前的四个星期，等着基督降生。要收心，少吃肉，不办婚事，热闹都留到圣诞。",
    personal: {
      joan: "将临期不办婚事。那门亲事，至少能拖到圣诞以后再说。",
      edmund: "他换上紫色的祭衣。一年里只有这几个星期，他觉得自己知道该讲什么。",
    },
    signs: [{ at: ["church"], text: "祭台上的布换成了紫的。" }],
  },
  {
    key: "nicholas",
    name: "圣尼古拉节",
    when: { feast: "nicholas" },
    lore: "孩子们的圣人。村里从孩子里挑一个当一天的“小主教”，穿上缩小的祭衣，大人们都得听他的，到诸圣婴孩节才算完。",
    personal: {
      edmund: "按老规矩，他得把讲台让给小主教一天，他不太情愿。",
    },
    signs: [{ at: ["church", "green"], text: "一个半大孩子披着拖地的白袍子，头上顶着纸糊的主教冠，后面跟着一群笑闹的孩子。" }],
  },
  {
    key: "christmas",
    name: "圣诞节",
    when: { feast: "christmas" },
    lore: "前一晚守斋，半夜望子夜弥撒。从这天起十二天不干活，宴饮、串门、演戏，一年里最长的假。领主有时请佃户吃一顿。",
    personal: {
      hubert: "他年轻时在庄园的圣诞宴上坐过上席，到现在还念叨那只烤天鹅。",
      matilda: "十二天里酒馆没有空的时候。",
    },
    signs: [
      { days: [-2, 0], at: OUTDOORS, text: "家家门口挂上了冬青和常春藤。" },
      { days: [-1, -1], periods: ["night", "deep_night"], text: "半夜，教堂亮着灯，钟声叫人去望子夜弥撒。" },
    ],
  },
  {
    key: "christmastide",
    name: "圣诞十二日",
    when: { season: "christmastide" },
    lore: "圣诞到主显节的十二天，不干重活。天天有人请客，年轻人戴着纸糊的面具挨家演戏讨酒喝。",
    signs: [
      { at: ["alehouse"], text: "酒馆里挤满了人。有人戴着纸糊的牛头，在演一出戏。" },
      { at: ["green"], text: "井边几个人戴着纸面具，敲着锅盖从这家走到那家。" },
    ],
  },
  {
    key: "epiphany",
    name: "主显节",
    when: { feast: "epiphany" },
    lore: "三王来朝的日子，圣诞十二日的最后一天。晚上分吃一个藏着一颗豆子的饼，吃到豆子的人当一晚上的“豆王”。",
    signs: [{ at: ["alehouse", "green_house", "atwood_cottage"], days: [-1, 0], periods: ["evening", "night"], text: "屋里有人在切一个大饼，大伙儿都盯着刀。" }],
  },
  {
    key: "plough_monday",
    name: "犁地星期一",
    when: { feast: "plough_monday" },
    lore: "节过完了，该下地了。年轻人拖着一张犁挨家讨钱，不给的，就在他门口的地上犁一道沟。",
    signs: [{ at: ["green", "manor_road"], text: "几个小伙子拖着一张扎了彩带的犁，一边吆喝一边敲门。" }],
  },
  {
    key: "candlemas",
    name: "圣烛节",
    when: { feast: "candlemas" },
    lore: "圣母带耶稣进圣殿的日子。人人举着蜡烛进教堂，神父把一年要用的蜡烛都祝圣了。老话说这天要是天晴，冬天还长着呢。",
    signs: [{ at: ["church", "churchyard"], text: "人人手里举着一支蜡烛，排着队进教堂，烛油滴在手背上。" }],
  },
  // ---------------------------------------------------------------- 春
  {
    key: "shrove_tuesday",
    name: "忏悔星期二",
    when: { feast: "shrove_tuesday" },
    lore: "大斋前最后一天。家里的鸡蛋、油、肉都得吃完，烙煎饼；下午年轻人在野地里踢球，两个村子踢一个球。",
    personal: { joan: "她每年都去看踢球，嘴上说是去看谁摔得最惨。" },
    signs: [
      { at: HOMES, text: "谁家灶上在烙饼，油香飘了半条路。" },
      { at: ["common", "east_field", "west_field"], periods: ["afternoon"], text: "一群人追着一个猪尿泡吹的球满地跑，喊声隔着田都听得见。" },
    ],
  },
  {
    key: "ash_wednesday",
    name: "圣灰星期三",
    when: { feast: "ash_wednesday" },
    lore: "大斋开始。神父把去年圣枝主日的枝条烧成灰，抹在每个人额头上：“记住你是尘土。”",
    signs: [{ at: OUTDOORS, text: "迎面走来的人，额头上都有一道灰。" }],
  },
  {
    key: "lent",
    name: "大斋期",
    when: { season: "lent" },
    lore: "复活节前的四十天。不吃肉，不吃蛋和奶，不办婚事。咸鱼和豆子吃得人发慌。",
    personal: { matilda: "大斋期酒照卖，客人少，她的脾气更坏。" },
    signs: [{ at: ["alehouse"], text: "桌上只有咸鱼和豆子。" }],
  },
  {
    key: "palm_sunday",
    name: "圣枝主日",
    when: { feast: "palm_sunday" },
    lore: "耶稣进耶路撒冷的日子。这儿没有棕榈，人们举着柳枝绕教堂走，神父给枝条祝福，拿回家插在门上。",
    signs: [{ at: ["church", "churchyard", "green"], text: "每个人手里都拿着一枝冒了芽的柳条。" }],
  },
  {
    key: "good_friday",
    name: "耶稣受难日",
    when: { feast: "good_friday" },
    lore: "耶稣死在十字架上的日子。祭台撤空，人们跪着挪到十字架前去亲它。这天什么也不吃。",
    signs: [{ at: ["church"], text: "祭台撤空了，十字架用一块布蒙着。" }],
  },
  {
    key: "easter",
    name: "复活节",
    when: { feast: "easter" },
    lore: "一年里最大的节。大斋结束，又能吃肉吃蛋了。人们把染了色的鸡蛋送人，也送给神父。",
    signs: [{ at: ["green", "church"], text: "孩子们攥着染红的鸡蛋，往对方的蛋上磕，比谁的硬。" }],
  },
  {
    key: "hock_tuesday",
    name: "霍克星期二",
    when: { feast: "hock_tuesday" },
    lore: "复活节后的第二个星期二。女人们拿绳子拦路，绑住过路的男人，交了钱才放，钱归教堂；第二天轮到男人绑女人。",
    personal: { joan: "她向来是拿绳子拦路最起劲的一个。" },
    signs: [{ at: ["green", "manor_road"], text: "几个女人扯着一根绳子守在路口，见了男人就笑着围上去。" }],
  },
  {
    key: "may_day",
    name: "五朔节",
    when: { feast: "philip_james" },
    lore: "五月头一天。年轻人天不亮就进林子折开花的山楂枝，插在门上；井边立起一根杆子，大家绕着跳舞。姑娘们用早上的露水洗脸，说能变好看。",
    personal: { joan: "她嘴上说露水洗脸是骗小姑娘的，天不亮还是去了。" },
    signs: [
      { at: ["north_wood"], periods: ["dawn", "morning"], text: "林子里到处是人，在折山楂花的枝子，笑声隔着树都听得见。" },
      { at: ["green"], text: "井边立起了一根高杆，杆顶扎着花和彩带。" },
    ],
  },
  {
    key: "rogation",
    name: "祈祷日",
    when: { feast: "rogation" },
    lore: "一连三天，神父领着全村绕村界走一圈，在每块界石前停下念经，还把孩子在界石上磕一下，让他记住村界在哪儿。",
    personal: { hubert: "他认得每一块界石，每年都要当众纠正神父哪块走错了。" },
    signs: [{ at: FIELDS, days: [0, 2], text: "一队人跟着十字架和旗子沿着田埂走，走在前头的是神父。" }],
  },
  // ---------------------------------------------------------------- 夏
  {
    key: "whitsun",
    name: "圣灵降临节",
    when: { feast: "pentecost" },
    lore: "复活节后第五十天。之后几天，教堂酿的麦酒拿出来卖，叫“教堂麦酒”，钱用来修教堂。",
    personal: { matilda: "教堂麦酒那几天，她的生意被抢了一半，嘴上还得说是好事。" },
    signs: [{ at: ["green"], days: [0, 2], text: "井边摆着几张长桌，在卖教堂酿的麦酒。" }],
  },
  {
    key: "midsummer",
    name: "仲夏",
    when: { feast: "john_baptist" },
    lore: "施洗约翰的生日，一年里白天最长的时候。前一晚家家门口点篝火，烧骨头和杂草驱邪，年轻人从火上跳过去。也是季度结账日。",
    signs: [{ days: [-1, -1], periods: ["evening", "night"], at: OUTDOORS, text: "家家门口都烧着一堆火，烟里有股烧骨头的味道。" }],
  },
  {
    key: "margaret",
    name: "圣玛格丽特节",
    when: { feast: "margaret" },
    lore: "本村教堂的主保圣人的节日。全村都来望弥撒，之后井边摆集，邻村的人也来。",
    signs: [{ at: ["green"], text: "井边搭起了几个货摊，来了好些生面孔。" }],
  },
  {
    key: "lammas",
    name: "收获节",
    when: { feast: "lammas" },
    lore: "用今年新麦烤的头一个面包拿到教堂祝圣，一年的收割就算开了头。",
    personal: { thomas: "新麦要来磨了，这是磨坊最忙、闲话也最多的时候。" },
    signs: [{ at: ["church"], text: "祭台上放着一个圆面包，烤得有点焦。" }],
  },
  {
    key: "michaelmas",
    name: "圣米迦勒节",
    when: { feast: "michaelmas" },
    lore: "季度结账日。庄园算一年的总账，选下一年的庄头。这天要吃一只鹅。",
    personal: {
      hubert: "他做了多年庄头，每到这天就坐立不安。",
      joan: "她放的鹅，这时候卖得最好。",
    },
    signs: [{ at: ["green", "manor"], text: "有人提着鹅往庄园那边走，鹅伸着脖子乱叫。" }],
  },
  // ---------------------------------------------------------------- 每天、每周
  {
    key: "bell:curfew",
    name: "熄火钟",
    when: { bell: "curfew" },
    lore: "晚上敲过这遍钟，家家要把炉火拢起来、盖上灰，免得夜里起火。按理，这以后就不该有人在外头走了。",
    personal: { matilda: "熄火钟一响，她的酒馆照理就该关门，可总有几个人赖着不走，神父也在其中。" },
    signs: [{ text: "窗缝里的火光一家家暗下去。有人在屋里拿铲子往炉膛上压灰。" }],
  },
  {
    key: "bell:vespers",
    name: "晚祷钟",
    when: { bell: "vespers" },
    lore: "太阳落山前敲。地里的人听见就收工往回走，教堂里念晚祷。",
    signs: [{ at: [...FIELDS, "green"], text: "田里的人扛着农具往回走，影子拖得很长。" }],
  },
  {
    key: "fast:friday",
    name: "星期五守斋",
    when: { fast: "friday" },
    lore: "星期五是耶稣受难的日子，每个星期五都守斋，不吃肉。有鱼吃鱼，没鱼就吃豆子和面包。",
    signs: [
      { at: ["ford"], text: "渡口边有人蹲着下网。" },
      { at: ["green"], text: "井边有人提着一串小鱼，鱼还在甩尾巴。" },
    ],
  },
  {
    key: "fast:ember",
    name: "四季斋日",
    when: { fast: "ember" },
    lore: "一年四次，每次三天，守斋祈祷，求这一季的收成和天气。",
  },
];

export const CUSTOM_KEYS: ReadonlySet<string> = new Set(customs.map((c) => c.key));
