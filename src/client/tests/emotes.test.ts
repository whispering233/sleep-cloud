import { describe, expect, it } from 'vitest';

import { EMOTE_IDS } from '../../shared/protocol';
import { EMOTE_LABELS, EMOTE_LIST } from '../emotes';

describe('表情标签', () => {
  it('共享枚举里每个值都有非空标签（新增枚举值忘了配标签就立刻失败）', () => {
    for (const id of EMOTE_IDS) {
      expect(EMOTE_LABELS[id]?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });

  it('按钮顺序就是共享枚举的顺序', () => {
    expect([...EMOTE_LIST]).toEqual([...EMOTE_IDS]);
  });
});
