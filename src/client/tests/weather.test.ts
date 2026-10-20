import { describe, expect, it } from 'vitest';

import { weatherLabel } from '../weather';

describe('天气文案', () => {
  it('文案 = 当前天气', () => {
    expect(weatherLabel(true)).toBe('雨天');
    expect(weatherLabel(false)).toBe('无雨');
  });
});
