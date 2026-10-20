// The game clock. In production it is the real clock; dev mode may swap in a fake one
// that runs at a multiple of real time or jumps to a chosen instant (技术设计 §4.1).

export interface Clock {
  /** Current game instant, epoch milliseconds. */
  now(): number;
}

export const realClock: Clock = { now: () => Date.now() };

export interface FakeClockState {
  /** Real instant at which the game instant was `anchorGame`. */
  anchorReal: number;
  anchorGame: number;
  /** Game milliseconds per real millisecond. 0 pauses the clock. */
  speed: number;
}

export function fakeNow(state: FakeClockState, realNow: number): number {
  return state.anchorGame + (realNow - state.anchorReal) * state.speed;
}

/** Re-anchor at `realNow` so a speed change or jump never makes time leap backwards by accident. */
export function adjustFakeClock(
  state: FakeClockState | null,
  realNow: number,
  change: { speed?: number; jumpTo?: number },
): FakeClockState {
  const current = state ? fakeNow(state, realNow) : realNow;
  return {
    anchorReal: realNow,
    anchorGame: change.jumpTo ?? current,
    speed: change.speed ?? state?.speed ?? 1,
  };
}

export function fakeClock(state: FakeClockState, realNow: () => number = Date.now): Clock {
  return { now: () => fakeNow(state, realNow()) };
}
