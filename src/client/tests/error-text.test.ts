import { describe, expect, it } from 'vitest';

import { ERROR_MESSAGES } from '../../shared/error-code';
import { readDoc, tableRows } from '../../shared/tests/doc';
import { ERROR_FALLBACK_TEXT, ERROR_TEXT, blockedTextFor, errorTextFor } from '../error-text';

/**
 * 文档里的「用户可见文案方向」列（`docs/api/error-code.md` §2）。
 * 可显示的用「」括起来、静默的写成一句话描述——这正是「有文案 / 没文案」的分界，所以期望值直接从这列推导。
 */
const docDirections = tableRows(readDoc('api/error-code.md'), '## 2. 错误码表', '## 3. 使用规则')
  .map(([code, , , direction]) => [code.replaceAll('"', ''), direction] as const)
  .filter(([code]) => code !== '0');

/**
 * 「进入前请先确认」→ 文案；「静默丢弃」→ `undefined`。
 * 文案方向后面可以跟一段注记（例如 3008 的「（可恢复）」），所以只要求**以「…」开头**。
 */
const quotedText = (direction: string): string | undefined => /^「(.+)」/.exec(direction)?.[1];

describe('错误码文案映射', () => {
  it('静默集合（1001/2004/2005/3001/3004/3005/3006/4002/4003）返回 undefined', () => {
    const silentCodes = docDirections
      .filter(([, direction]) => quotedText(direction) === undefined)
      .map(([code]) => code);
    expect(silentCodes).toEqual(['1001', '2004', '2005', '3001', '3004', '3005', '3006', '4002', '4003']);
    for (const code of silentCodes) expect(errorTextFor(code), `${code} 不该有文案`).toBeUndefined();
  });

  it('ERROR_MESSAGES 里的每个码都有交代：静默或有文案（除 "0"）', () => {
    const codes = Object.keys(ERROR_MESSAGES).filter((code) => code !== '0');
    expect(codes).toHaveLength(27); // 漏一个码在类型层就过不了，这里再钉一次数量（已删 1006，新增 4004 / 5004）
    // 键集合也要对拍：静默码在映射表里是 `undefined` 值，只查值就分不出「漏了键」
    expect(Object.keys(ERROR_TEXT).sort()).toEqual([...codes].sort());
    for (const code of codes) {
      const direction = docDirections.find(([docCode]) => docCode === code)?.[1];
      expect(direction, `文档里缺少 ${code} 的文案方向`).toBeDefined();
      expect(errorTextFor(code), `${code} 与文档不一致`).toBe(quotedText(direction ?? ''));
    }
  });

  it('封禁文案带到期时间（`70-privacy-risk.md` §5.4：给时间，不给原因）', () => {
    const now = 1_700_000_000_000;
    const minutes = (n: number) => n * 60_000;
    // 永久：不带倒计时
    expect(blockedTextFor(null, now)).toBe('你暂时无法进入');
    // 还有 8 分钟
    expect(blockedTextFor(now + minutes(8), now)).toBe('你暂时无法进入 · 还有 8 分钟');
    // 不足 1 分钟也报「1 分钟」：说少了会让用户按「已经解封了」反复重试
    expect(blockedTextFor(now + 30_000, now)).toBe('你暂时无法进入 · 还有 1 分钟');
    expect(blockedTextFor(now + 1, now)).toBe('你暂时无法进入 · 还有 1 分钟');
    // 不是整分钟时向上取整（7 分 30 秒 → 8 分钟）
    expect(blockedTextFor(now + minutes(7.5), now)).toBe('你暂时无法进入 · 还有 8 分钟');
  });

  it('抽查可恢复类文案：给用户看的是人话，不是面向开发者的 msg', () => {
    expect(errorTextFor('1003')).toBe('给自己起个名字吧');
    expect(errorTextFor('1004')).toBe('名字 1~16 个字');
    expect(errorTextFor('2001')).toBe('请刷新页面');
    expect(errorTextFor('2002')).toBe('这个大厅满了');
    expect(errorTextFor('3002')).toBe('这张床有人了');
    expect(errorTextFor('4001')).toBe('消息太长了');
    expect(errorTextFor('5003')).toBe('已收到你的反馈');
    expect(errorTextFor('9001')).toBe(ERROR_FALLBACK_TEXT);
    expect(errorTextFor('9002')).toBe('大厅暂时进不去，稍后再试');
  });

  it('成功码与未知码都不给文案，兜底文案单独给（入场层只看这张表）', () => {
    expect(errorTextFor('0')).toBeUndefined();
    expect(errorTextFor('1234')).toBeUndefined();
    expect(errorTextFor('')).toBeUndefined();
    expect(ERROR_FALLBACK_TEXT).toBe('出了点问题，稍后再试');
  });
});