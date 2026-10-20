// 英格兰低地的气候（只求合理）。index 0 = 一月。

import type { MonthClimate, WeatherWords } from "@elmsford/core";

export const climate: MonthClimate[] = [
  { highC: 6, wet: 0.5, fog: 0.3, frost: 0.55, snow: 0.35, windy: 0.35 },
  { highC: 7, wet: 0.45, fog: 0.25, frost: 0.5, snow: 0.3, windy: 0.35 },
  { highC: 10, wet: 0.42, fog: 0.15, frost: 0.35, snow: 0.12, windy: 0.4 },
  { highC: 13, wet: 0.4, fog: 0.1, frost: 0.15, snow: 0.02, windy: 0.3 },
  { highC: 16, wet: 0.38, fog: 0.08, frost: 0.03, snow: 0, windy: 0.25 },
  { highC: 19, wet: 0.35, fog: 0.05, frost: 0, snow: 0, windy: 0.2 },
  { highC: 21, wet: 0.33, fog: 0.04, frost: 0, snow: 0, windy: 0.18 },
  { highC: 21, wet: 0.36, fog: 0.06, frost: 0, snow: 0, windy: 0.2 },
  { highC: 18, wet: 0.38, fog: 0.15, frost: 0.02, snow: 0, windy: 0.25 },
  { highC: 14, wet: 0.45, fog: 0.28, frost: 0.15, snow: 0, windy: 0.32 },
  { highC: 10, wet: 0.5, fog: 0.32, frost: 0.35, snow: 0.08, windy: 0.38 },
  { highC: 7, wet: 0.5, fog: 0.3, frost: 0.5, snow: 0.3, windy: 0.38 },
];

export const weatherWords: WeatherWords = {
  sky: {
    clear: "晴，天很高",
    fair: "大半天有太阳",
    cloudy: "多云",
    overcast: "阴着",
    fog: "早上起了大雾，河面上白茫茫的",
    drizzle: "飘着细雨",
    rain: "下雨",
    storm: "风雨交加",
    snow: "下雪",
  },
  wind: { calm: "没有风", breeze: "有点风", windy: "风大", gale: "刮大风，树枝乱摆" },
  temp: (c) => (c <= 0 ? "冷得手指发僵" : c <= 5 ? "很冷" : c <= 10 ? "冷" : c <= 15 ? "凉" : c <= 20 ? "不冷不热" : c <= 25 ? "暖和" : "热"),
  frost: "地上结了霜",
  wetAfterWet: "路上全是泥",
};
