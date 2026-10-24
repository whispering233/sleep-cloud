import { describe, expect, it } from 'vitest';

import { soundLabel, weatherLabel, weatherOptionsOf } from '../weather';

describe('天气文案', () => {
  it('三态各有自己的文案', () => {
    expect(weatherLabel('none')).toBe('无雨');
    expect(weatherLabel('rain')).toBe('雨天');
    expect(weatherLabel('snow')).toBe('雪');
  });
});

describe('天气候选（weather-picker）', () => {
  it('顺序固定、三项齐全：无雨 → 雨天 → 雪', () => {
    expect(weatherOptionsOf()).toEqual([
      { id: 'none', label: '无雨' },
      { id: 'rain', label: '雨天' },
      { id: 'snow', label: '雪' },
    ]);
  });
});

describe('雨声文案', () => {
  it('文案 = 当前状态，不嵌带天气的话', () => {
    expect(soundLabel(true)).toBe('雨声');
    expect(soundLabel(false)).toBe('静音');
  });
});
