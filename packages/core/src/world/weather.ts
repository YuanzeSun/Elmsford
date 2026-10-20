// Daily weather: a Markov chain over a monthly climate, seeded by village and date.
// Wet days tend to follow wet days; the climate table (content) gives the base odds.

import { seededRng } from "./random";

export type Sky = "clear" | "fair" | "cloudy" | "overcast" | "fog" | "drizzle" | "rain" | "storm" | "snow";
export type Wind = "calm" | "breeze" | "windy" | "gale";

export interface Weather {
  sky: Sky;
  tempC: number;
  wind: Wind;
  frost: boolean;
  text: string;
}

export interface MonthClimate {
  /** Typical daytime high, °C. */
  highC: number;
  /** Chance a given day is wet. */
  wet: number;
  /** Chance a dry day is foggy (mornings). */
  fog: number;
  /** Chance of frost overnight. */
  frost: number;
  /** Chance a wet day is snow rather than rain. */
  snow: number;
  /** Chance of a windy day. */
  windy: number;
}

export interface WeatherWords {
  sky: Record<Sky, string>;
  wind: Record<Wind, string>;
  temp: (c: number) => string;
  frost: string;
  wetAfterWet: string;
}

const WET: ReadonlySet<Sky> = new Set(["drizzle", "rain", "storm", "snow"]);
export const isWet = (w: Pick<Weather, "sky">) => WET.has(w.sky);

/**
 * Today's weather from the month's climate and yesterday's weather.
 * `seed` should identify the village and the date.
 */
export function rollWeather(climate: MonthClimate, yesterday: Weather | null, seed: string, words: WeatherWords): Weather {
  const rng = seededRng(seed);
  const persistence = yesterday ? (isWet(yesterday) ? 0.25 : -0.12) : 0;
  const wetChance = Math.min(0.9, Math.max(0.05, climate.wet + persistence));
  const wet = rng() < wetChance;
  const tempC = Math.round(climate.highC + (rng() - 0.5) * 6 + (wet ? -1 : 0) + (yesterday ? (yesterday.tempC - climate.highC) * 0.4 : 0));
  const windRoll = rng();
  const wind: Wind = windRoll < climate.windy * 0.25 ? "gale" : windRoll < climate.windy ? "windy" : windRoll < 0.7 ? "breeze" : "calm";

  let sky: Sky;
  if (wet) {
    const snowy = tempC <= 3 && rng() < climate.snow;
    const r = rng();
    sky = snowy ? "snow" : wind === "gale" && r < 0.5 ? "storm" : r < 0.35 ? "drizzle" : "rain";
  } else {
    const r = rng();
    sky = wind === "calm" && rng() < climate.fog ? "fog" : r < 0.2 ? "clear" : r < 0.5 ? "fair" : r < 0.8 ? "cloudy" : "overcast";
  }
  const frost = !wet && tempC <= 8 && rng() < climate.frost;

  const parts = [words.sky[sky], words.temp(tempC)];
  if (wind !== "calm" && wind !== "breeze") parts.push(words.wind[wind]);
  if (frost) parts.push(words.frost);
  if (yesterday && isWet(yesterday) && !wet) parts.push(words.wetAfterWet);
  return { sky, tempC, wind, frost, text: `${parts.join("，")}。` };
}
