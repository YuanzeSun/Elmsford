// Elmsford 的地点（设定圣经 §3.2）。玩家沿着 neighbors 走动；offstage 的地方只有村民能去。
// house 是人家：没人在家就进不去。谁住哪儿看居民的 homeId。

import type { Location } from "@elmsford/core";

export const locations: Location[] = [
  { id: "player_house", short: "你家", name: "你的屋子", description: "墓园边上一间空了多年的屋子，归教堂所有。", neighbors: ["churchyard", "green"] },
  { id: "churchyard", short: "墓园", name: "墓园", description: "教堂边上的墓地，新坟旧坟挨在一起。", neighbors: ["player_house", "church"] },
  { id: "church", short: "教堂", name: "圣玛格丽特教堂", description: "村里唯一的石头房子。", neighbors: ["churchyard", "green", "priest_house"] },
  { id: "priest_house", short: "神父家", name: "神父的住处", description: "教堂后面一间小屋。", neighbors: ["church"], house: true },
  { id: "green", short: "井边", name: "井边", description: "村子正中的一片草地，当中是公用的井，井沿边有条石凳。", neighbors: ["player_house", "church", "alehouse", "green_house", "atwood_cottage", "lane", "manor_road"] },
  { id: "alehouse", short: "酒馆", name: "玛蒂尔达家", description: "渡口坡上的一栋房子，她在家里酿酒、卖酒。门口挂着一把扫帚，说明有酒卖。", neighbors: ["green", "ford"], house: true },
  { id: "ford", short: "渡口", name: "渡口", description: "埃尔河上一处浅浅的渡口。", neighbors: ["alehouse", "meadow", "mill"] },
  { id: "mill", short: "磨坊", name: "磨坊", description: "在村子下游，领主的产业。磨面得付磨费。韦尔一家住在磨坊边上。", neighbors: ["ford", "meadow"], house: true },
  { id: "meadow", short: "草场", name: "草场", description: "沿河的草场，夏天割干草。", neighbors: ["ford", "mill", "east_field"] },
  { id: "green_house", short: "格林家", name: "格林家", description: "休伯特和儿子一家住的房子。", neighbors: ["green"], house: true },
  { id: "lane", short: "巷子", name: "井边后面的巷子", description: "一排矮房子，瘟疫以后空了好几间，门板上长了青苔。", neighbors: ["green"] },
  { id: "atwood_cottage", short: "茅舍", name: "阿特伍德家的茅舍", description: "村边一间茅舍，屋后有块菜园。", neighbors: ["green", "common"], house: true },
  { id: "common", short: "公地", name: "公地", description: "大家放鹅放猪的地方。", neighbors: ["atwood_cottage", "west_field", "north_wood"] },
  { id: "east_field", short: "东田", name: "东田", description: "三块大田之一，今年秋天轮到休耕放牧。", neighbors: ["meadow", "manor_road"] },
  { id: "west_field", short: "西田", name: "西田", description: "三块大田之一。", neighbors: ["common", "manor_road"] },
  { id: "south_field", short: "南田", name: "南田", description: "三块大田之一。", neighbors: ["manor_road"] },
  { id: "manor_road", short: "北路", name: "去庄园的路", description: "从井边往北，路两边是大田。", neighbors: ["green", "east_field", "west_field", "south_field", "manor"] },
  { id: "manor", short: "庄园", name: "庄园宅邸", description: "村子北边。领主难得来，平时由管家打理。", neighbors: ["manor_road", "north_wood"] },
  { id: "north_wood", short: "林子", name: "北边的林子", description: "砍柴得有领主的许可。", neighbors: ["manor", "common"] },
  { id: "kingsbury", short: "金斯伯里", name: "金斯伯里", description: "最近的集镇，步行要大半天，每周四赶集。", neighbors: [], offstage: true },
];
