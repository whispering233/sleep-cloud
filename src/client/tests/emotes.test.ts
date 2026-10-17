import { describe, expect, it } from 'vitest';

import { EMOTE_SHORTCUTS } from '../emotes';

describe('表情快捷表', () => {
  it('每一项都有非空 emoji 字形与中文可访问名（字形给眼睛看，中文只给屏读）', () => {
    for (const { glyph, label } of EMOTE_SHORTCUTS) {
      expect(glyph.trim().length).toBeGreaterThan(0);
      expect(label.trim().length).toBeGreaterThan(0);
    }
  });

  it('字形互不重复：按钮的 key 与最简断言都靠它', () => {
    expect(new Set(EMOTE_SHORTCUTS.map((item) => item.glyph)).size).toBe(EMOTE_SHORTCUTS.length);
  });
});
