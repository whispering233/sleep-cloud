import { describe, expect, it } from 'vitest';

import { QUICK_PHRASE_MAX, QUICK_PHRASES } from '../quick-phrases';

describe('快捷用语表', () => {
  it('条数在上限之内：第 9 条起要重新设计插槽面板的排布（§附）', () => {
    expect(QUICK_PHRASES.length).toBeGreaterThan(0);
    expect(QUICK_PHRASES.length).toBeLessThanOrEqual(QUICK_PHRASE_MAX);
  });

  it('文案非空且互不重复（列表 key 与「点哪条填哪条」都靠它）', () => {
    for (const phrase of QUICK_PHRASES) expect(phrase.trim().length).toBeGreaterThan(0);
    expect(new Set(QUICK_PHRASES).size).toBe(QUICK_PHRASES.length);
  });
});