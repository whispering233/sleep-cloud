import { describe, expect, it } from 'vitest';

import { emoteVerdictFor } from '../emote';

describe('表情判定', () => {
  it('共享枚举里的 5 个值全部通过', () => {
    for (const id of ['wave', 'zzz', 'heart', 'cry', 'hug']) {
      expect(emoteVerdictFor(id)).toEqual({ ok: true, emoteId: id });
    }
  });

  it('非字符串、未知名一律静默丢弃（不回错误码）', () => {
    expect(emoteVerdictFor(undefined)).toEqual({ ok: false });
    expect(emoteVerdictFor(42)).toEqual({ ok: false });
    expect(emoteVerdictFor({ id: 'wave' })).toEqual({ ok: false });
    expect(emoteVerdictFor('dance')).toEqual({ ok: false });
  });
});
