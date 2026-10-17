import { describe, expect, it } from 'vitest';

import { bubbleHintOf, BUBBLE_TEXT_PX, estimateBubbleLines } from '../bubble-fit';

/** 13px 的中文一行 14 个（14 × 13 = 182 ≤ 192 = `BUBBLE_TEXT_PX`），所以两行的容量是 28 个。 */
const CJK_PER_LINE = Math.floor(BUBBLE_TEXT_PX / 13);

describe('气泡行数估算', () => {
  it('空串 0 行', () => {
    expect(estimateBubbleLines('')).toBe(0);
  });

  it('短文本 1 行', () => {
    expect(estimateBubbleLines('睡不着')).toBe(1);
  });

  it('恰好两行就是 2 行（不误报）', () => {
    expect(estimateBubbleLines('睡'.repeat(CJK_PER_LINE * 2))).toBe(2);
  });

  it('单调：文本变长行数不减', () => {
    const texts = ['', '睡', '睡'.repeat(CJK_PER_LINE), '睡'.repeat(CJK_PER_LINE + 1), '睡'.repeat(40)];
    const lines = texts.map(estimateBubbleLines);
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
    expect(lines.at(-1)).toBeGreaterThan(lines[0]);
  });

  it('中英混排按各自字符宽累加（拉丁窄，同一行装得下更多）', () => {
    const latin = 'x'.repeat(40);
    expect(estimateBubbleLines(latin)).toBeLessThan(estimateBubbleLines('睡'.repeat(40)));
  });

  it('同字数下 emoji 估出的行数不少于中文（emoji 比中文宽，只会估多不会估少）', () => {
    const emojiLines = estimateBubbleLines('😴'.repeat(20));
    const cjkLines = estimateBubbleLines('睡'.repeat(20));
    expect(emojiLines).toBeGreaterThanOrEqual(cjkLines);
    expect(emojiLines).toBeGreaterThan(cjkLines);
  });

  it('emoji 一行装 9 个（21px × 9 = 189 ≤ 192，第 10 个就换行）', () => {
    expect(estimateBubbleLines('😴'.repeat(9))).toBe(1);
    expect(estimateBubbleLines('😴'.repeat(10))).toBe(2);
  });

  it('ZWJ 序列按字素簇算：连接符零宽，一家人不会被数成 7 个宽字符', () => {
    const family = '👨‍👩‍👧‍👦';
    expect(estimateBubbleLines(family)).toBe(1);
    // 2 × (4 × 21) = 168 ≤ 192；ZWJ 若也占一档就是 2 行
    expect(estimateBubbleLines(family.repeat(2))).toBe(1);
  });

  it('肤色修饰符与键帽零宽：一簇只算基字符那一次宽', () => {
    expect(estimateBubbleLines('👍🏽'.repeat(9))).toBe(1);
    expect(estimateBubbleLines('1️⃣'.repeat(24))).toBe(1);
  });
});

describe('气泡放不下的提示', () => {
  it('短文本（一行）不给提示', () => {
    expect(bubbleHintOf('睡不着')).toBeUndefined();
  });

  it('恰好两行不给提示', () => {
    expect(bubbleHintOf('睡'.repeat(CJK_PER_LINE * 2))).toBeUndefined();
  });

  it('空串不给提示', () => {
    expect(bubbleHintOf('')).toBeUndefined();
  });

  it('明显超长的中文：有提示，且末尾被吃掉的字数 > 0', () => {
    const hint = bubbleHintOf('睡'.repeat(40));
    expect(hint).toContain('末尾约 12 字会变成 …');
    const trailing = Number(/末尾约 (\d+) 字/.exec(hint ?? '')?.[1]);
    expect(trailing).toBeGreaterThan(0);
  });

  it('超长英文（拉丁宽度）也能触发', () => {
    const hint = bubbleHintOf('x'.repeat(100));
    expect(hint).toBeDefined();
    expect(Number(/末尾约 (\d+) 字/.exec(hint ?? '')?.[1])).toBeGreaterThan(0);
  });
});