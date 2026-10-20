import { describe, expect, it } from 'vitest';

import { defaultRainAt, weatherLabel } from '../weather';

/** 文档里的公式（`docs/design/config.md` §4）：本地日历 → `Date.UTC` 序号 → 奇偶。 */
const byOrdinal = (y: number, m: number, d: number): boolean =>
  Math.floor(Date.UTC(y, m, d) / 86_400_000) % 2 === 1;

describe('天气的日期默认（sc.weather.rain 缺键时）', () => {
  it('取本地日历日序号的奇偶，且同一天的任何时刻都同天气（不取毫秒 / 时区偏移）', () => {
    expect(defaultRainAt(new Date(2024, 0, 15))).toBe(byOrdinal(2024, 0, 15));
    expect(defaultRainAt(new Date(2024, 0, 15, 0, 0, 0))).toBe(defaultRainAt(new Date(2024, 0, 15, 23, 59, 59)));
  });

  it('相邻日相反；跨月也成立（31 号与次月 1 号是连着的两天，闰日同理）', () => {
    for (let day = 1; day <= 28; day += 1) {
      expect(defaultRainAt(new Date(2024, 1, day))).not.toBe(defaultRainAt(new Date(2024, 1, day + 1)));
    }
    expect(defaultRainAt(new Date(2024, 0, 31))).not.toBe(defaultRainAt(new Date(2024, 1, 1)));
    expect(defaultRainAt(new Date(2024, 1, 29))).not.toBe(defaultRainAt(new Date(2024, 2, 1)));
  });

  it('文案 = 当前天气', () => {
    expect(weatherLabel(true)).toBe('雨天');
    expect(weatherLabel(false)).toBe('无雨');
  });
});
