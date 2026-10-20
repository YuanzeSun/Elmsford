// Wall-clock conversion for the player's IANA time zone, via Intl (no tz database of our own).

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** Minutes east of UTC at this instant, including DST. */
  offsetMinutes: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(instant: number, timeZone: string): ZonedParts {
  const values: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(instant))) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  const year = values.year!;
  const month = values.month!;
  const day = values.day!;
  const hour = values.hour!;
  const minute = values.minute!;
  const second = values.second!;
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMinutes = Math.round((wallAsUtc - Math.floor(instant / 1000) * 1000) / 60_000);
  return { year, month, day, hour, minute, second, offsetMinutes };
}

/** Instant at which the wall clock in `timeZone` reads the given local time. */
export function zonedToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let instant = wallAsUtc - zonedParts(wallAsUtc, timeZone).offsetMinutes * 60_000;
  // A second pass settles instants near a DST transition.
  instant = wallAsUtc - zonedParts(instant, timeZone).offsetMinutes * 60_000;
  return instant;
}

/** The zone's standard (non-DST) offset for a year: the smaller of its January and July offsets. */
export function standardOffsetMinutes(year: number, timeZone: string): number {
  const jan = zonedParts(Date.UTC(year, 0, 1, 12), timeZone).offsetMinutes;
  const jul = zonedParts(Date.UTC(year, 6, 1, 12), timeZone).offsetMinutes;
  return Math.min(jan, jul);
}
