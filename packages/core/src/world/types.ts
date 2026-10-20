// Core world entities (技术设计 §4.2). Times are stored as epoch milliseconds; derive a
// GameTime with computeGameTime when the calendar view is needed.

export const PLAYER_ID = "player";

/** Who a character is. Read-only after seeding; personality changes only via weekly reflection. */
export interface CharacterSeed {
  occupation: string;
  personality: string;
  cares: string;
  flaws: string;
  wants: string;
  /** The situation at the start of the game. Later changes live in state, not here. */
  situation: string;
  speech: string;
  household?: string;
  homeId: string;
}

export interface CharacterState {
  /** 0–100 */
  health: number;
  mood: string;
  /** In pennies. */
  money: number;
  locationId: string;
  activity: string;
  /** What weighs on them right now (free text, updated by the system). */
  concerns: string[];
  /** Game time until which they won't stop to talk (they just walked off). */
  busyUntil?: number;
}

/** In the village; or gone away (left for good); or dead. Only those here are simulated. */
export type ResidentStatus = "here" | "gone" | "dead";

export interface Character {
  id: string;
  name: string;
  shortName: string;
  age: number;
  seed: Readonly<CharacterSeed>;
  state: CharacterState;
  status: ResidentStatus;
}

/** Directed: how `from` sees `to`. */
export interface Relationship {
  from: string;
  to: string;
  /** -100 … 100 */
  trust: number;
  /** -100 … 100 */
  affection: number;
  summary: string;
}

export interface FactKnowledge {
  characterId: string;
  /** 0 … 1 */
  belief: number;
  source: string;
}

export interface Fact {
  id: string;
  text: string;
  at: number;
  knownBy: FactKnowledge[];
}

export interface Memory {
  id: string;
  characterId: string;
  at: number;
  text: string;
  /** 1 … 10 */
  importance: number;
  participants: string[];
  factIds: string[];
  lastRecalledAt?: number;
}

export type CommitmentStatus = "open" | "kept" | "broken" | "released";

export interface Commitment {
  id: string;
  by: string;
  to: string;
  text: string;
  due?: number;
  status: CommitmentStatus;
}

export interface PlanBlock {
  from: string; // "HH:MM"
  to: string; // "HH:MM", "24:00" for end of day
  locationId: string;
  activity: string;
  withIds?: string[];
  /** Something they mean to do or say, which can start a background interaction. */
  intent?: string;
  asleep?: boolean;
}

export interface DayPlan {
  characterId: string;
  date: string; // YYYY-MM-DD
  blocks: PlanBlock[];
}

export type DocumentKind = "letter" | "contract" | "will" | "record";
export type DocumentStatus = "draft" | "sent" | "delivered" | "replied";

export interface WrittenDocument {
  id: string;
  kind: DocumentKind;
  commissionedBy: string;
  /** What the client dictated, word for word. */
  dictated: string;
  /** What the player actually wrote. May differ! */
  written: string;
  recipient?: string;
  status: DocumentStatus;
}

export interface WorldEvent {
  id: string;
  at: number;
  type: string;
  payload: unknown;
  visibleTo: string[];
}

export interface Location {
  id: string;
  name: string;
  /** Two or three characters, for the map. */
  short: string;
  description: string;
  neighbors: string[];
  /** Somewhere residents go but the player can't (yet): off the village map. */
  offstage?: boolean;
  /** Somebody's house: knock before going in. Whose it is follows from where residents live. */
  house?: boolean;
}
