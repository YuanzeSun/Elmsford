// Sun times for the village, estimated at 52°N (技术设计 §4.1).
//
// The village is assumed to sit on the player's standard-time meridian, so solar noon is
// 12:00 local mean time shifted only by the equation of time. Results are minutes after
// local *standard* midnight; callers add the DST offset to get wall-clock minutes.

import { dayOfYear, isLeapYear } from "./dates";

export const VILLAGE_LATITUDE = 52;

export interface SunTimes {
  civilDawn: number;
  sunrise: number;
  solarNoon: number;
  sunset: number;
  civilDusk: number;
  /** sunset − sunrise, in minutes */
  dayLength: number;
}

const RAD = Math.PI / 180;

export function sunTimes(year: number, month: number, day: number, latitude = VILLAGE_LATITUDE): SunTimes {
  // NOAA low-precision formulas, evaluated at local noon.
  const daysInYear = isLeapYear(year) ? 366 : 365;
  const gamma = ((2 * Math.PI) / daysInYear) * (dayOfYear(year, month, day) - 1);

  const equationOfTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const phi = latitude * RAD;
  const hourAngleMinutes = (zenithDeg: number): number => {
    const cosH =
      Math.cos(zenithDeg * RAD) / (Math.cos(phi) * Math.cos(declination)) - Math.tan(phi) * Math.tan(declination);
    // Clamp for polar day/night; never reached at 52°N but keeps the function total.
    return (Math.acos(Math.min(1, Math.max(-1, cosH))) / RAD) * 4;
  };

  const solarNoon = 720 - equationOfTime;
  const rise = hourAngleMinutes(90.833);
  const civil = hourAngleMinutes(96);

  return {
    civilDawn: solarNoon - civil,
    sunrise: solarNoon - rise,
    solarNoon,
    sunset: solarNoon + rise,
    civilDusk: solarNoon + civil,
    dayLength: 2 * rise,
  };
}
