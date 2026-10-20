import { describe, expect, it } from 'vitest';

import { soundLabel, weatherLabel } from '../weather';

describe('天气文案', () => {
  it('文案 = 当前天气', () => {
    expect(weatherLabel(true)).toBe('雨天');
    expect(weatherLabel(false)).toBe('无雨');
  });
});

describe('雨声文案', () => {
  it('文案 = 当前状态，不嵌带天气的话', () => {
    expect(soundLabel(true)).toBe('雨声');
    expect(soundLabel(false)).toBe('静音');
  });
});
