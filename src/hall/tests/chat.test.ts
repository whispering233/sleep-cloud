import { describe, expect, it } from 'vitest';

import { chatVerdictFor } from '../chat';

const MAX = 200;

describe('聊天文本判定', () => {
  it('非字符串 → 4003（不报错、不写附件）', () => {
    expect(chatVerdictFor(undefined, MAX)).toEqual({ ok: false, code: '4003' });
    expect(chatVerdictFor(42, MAX)).toEqual({ ok: false, code: '4003' });
    expect(chatVerdictFor({ text: '你好' }, MAX)).toEqual({ ok: false, code: '4003' });
  });

  it('空串与纯空白 → 4003', () => {
    expect(chatVerdictFor('', MAX)).toEqual({ ok: false, code: '4003' });
    expect(chatVerdictFor('   \n\t ', MAX)).toEqual({ ok: false, code: '4003' });
  });

  it('长度按字符计：正好等于上限放行，超过一个字符 → 4001', () => {
    expect(chatVerdictFor('好'.repeat(MAX), MAX)).toEqual({ ok: true, text: '好'.repeat(MAX) });
    expect(chatVerdictFor('好'.repeat(MAX + 1), MAX)).toEqual({ ok: false, code: '4001' });
  });

  it('正常文本原样返回，首尾空白被 trim', () => {
    expect(chatVerdictFor('  睡不着的人  ', MAX)).toEqual({ ok: true, text: '睡不着的人' });
  });

  it('命中敏感词：打码为等长 `*` 后照常放行（不拦截）', () => {
    const raw = '你 傻 逼 了';
    const verdict = chatVerdictFor(raw, MAX);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.text).not.toContain('傻');
    expect(verdict.text).toContain('*');
    expect(verdict.text).toHaveLength(raw.length);
  });
});
