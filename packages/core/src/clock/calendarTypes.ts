// Shape of the calendar data supplied by @elmsford/content. Core only computes; content names things.

export type FeastRank = "principal" | "major" | "minor";

export type FeastRule =
  | { kind: "fixed"; month: number; day: number; /** day used instead in leap years */ leapDay?: number }
  | { kind: "easter"; offset: number }
  | { kind: "advent"; offset: number }
  /** The first `weekday` (0 = Sunday) strictly after month/day, e.g. Plough Monday. */
  | { kind: "weekdayAfter"; month: number; day: number; weekday: number };

export interface FeastDef {
  id: string;
  name: string;
  rank: FeastRank;
  rule: FeastRule;
  /** A holy day: mass, and no heavy work. */
  holyDay?: boolean;
  /** The eve is a fast day (vigil). */
  fastingEve?: boolean;
  /** What the village does that day, for planners and scene text. */
  note?: string;
}

export type LiturgicalSeason =
  | "advent"
  | "christmastide"
  | "epiphany"
  | "septuagesima"
  | "lent"
  | "eastertide"
  | "trinity";

export type FastReason = "friday" | "lent" | "ember" | "vigil";

export type BellId = "dawn" | "mass" | "noon" | "vespers" | "curfew";

export type Period = "deep_night" | "dawn" | "morning" | "noon" | "afternoon" | "evening" | "night";

export interface CalendarData {
  feasts: FeastDef[];
  /** Ember days are the Wednesday, Friday and Saturday after each anchor. */
  emberAnchors: FeastRule[];
  seasonNames: Record<LiturgicalSeason, string>;
  fastReasonNames: Record<FastReason, string>;
  bellNames: Record<BellId, string>;
  periodNames: Record<Period, string>;
  /** Index 0 = Sunday. */
  weekdayNames: readonly string[];
  /** Field and household work by month; index 0 = January. */
  agrarianByMonth: readonly (readonly string[])[];
}
