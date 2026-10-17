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