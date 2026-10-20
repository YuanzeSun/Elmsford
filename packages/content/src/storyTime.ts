// 按自己的步子过（主要的玩法）：村子有自己的钟，只有你做事、歇着的时候才往前走。
// 一天分上午、下午、晚上三段，每段的钟点是定的；晚上过完就回家睡下，醒来是第二天上午。

import type { StorySegment } from "@elmsford/core";

export const storyDay = {
  segments: [
    { id: "morning", name: "上午", from: 7 * 60, to: 12 * 60 },
    { id: "afternoon", name: "下午", from: 12 * 60, to: 17 * 60 },
    { id: "evening", name: "晚上", from: 17 * 60, to: 21 * 60 },
  ] satisfies StorySegment[],
  /** Walking from one place to the next. */
  walkMinutes: 10,
  /** Talking: how much gets said in a minute, pauses and all. */
  talkCharsPerMinute: 150,
  /** Writing with a quill. */
  writeCharsPerMinute: 8,
  /** The longest a single thing done together can take (the resident judges it). */
  maxDoingMinutes: 180,
};
