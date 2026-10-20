// Story time: the village's own clock, for the mode where days go at the player's pace. A day is
// three fixed stretches (morning, afternoon, evening); after the evening comes the night, which
// the player sleeps through.

import type { BellRing } from "./bells";
import type { BellId } from "./calendarTypes";

export interface StorySegment {
  id: "morning" | "afternoon" | "evening";
  name: string;
  /** Minutes of the day. */
  from: number;
  to: number;
}

/** The stretch of the day a minute falls in; null at night (before the morning or after the evening). */
export function storySegmentAt(segments: readonly StorySegment[], minuteOfDay: number): StorySegment | null {
  return segments.find((s) => minuteOfDay >= s.from && minuteOfDay < s.to) ?? null;
}

/** The stretch after this one today, if any. */
export function nextStorySegment(segments: readonly StorySegment[], current: StorySegment): StorySegment | null {
  return segments[segments.indexOf(current) + 1] ?? null;
}

/** Bells that rang after `fromMinute` up to and including `toMinute`, on one day. */
export function bellsRung(today: readonly BellRing[], fromMinute: number, toMinute: number): BellId[] {
  return today.filter((b) => b.minute > fromMinute && b.minute <= toMinute).map((b) => b.id);
}
