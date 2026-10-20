import { VILLAGE } from "./names";

// 开场：第一次进村时看到的几段话。只交代进村前必须知道的；你的来历留白（设定圣经 §4）。

export const intro: string[] = [
  `${VILLAGE} 是埃尔河边的一个村子，一百五六十口人。河边长着榆树，河上有一处浅浅的渡口，村子就叫这个名字。`,
  "那场大瘟疫过去十几年了。几乎每家都死过人，村里还空着几间房子。你租下了其中一间，在墓园边上，房子归教堂，钥匙在神父手里。",
  "你是个抄写员。村里没几个人识字。要写信、立契约、念一封远方来的信，都得找人。往后，他们会来找你。",
  "你的箱子昨天才搬进屋。桌子有一条腿短了一截，墙角有点潮。",
];

/** How the days go, chosen once before walking in. The first is the one the game is made around. */
export const timeModes: { id: "story" | "real"; name: string; text: string }[] = [
  { id: "story", name: "按自己的步子", text: "你不动，日子也不动。上午、下午、晚上，一段一段地过。" },
  { id: "real", name: "和你同一天", text: "这里的日子和你过的是同一天。你不在的时候，他们也照样过。" },
];

/** One line under the intro, the only how-to in the game. */
export const introHint = "说话时，动作写在星号里，比如 *把酒杯推过去*。";
