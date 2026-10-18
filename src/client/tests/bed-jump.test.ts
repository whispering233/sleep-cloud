import { describe, expect, it } from 'vitest';

import { parseJumpTarget } from '../bed-jump';

const BED_COUNT = 117; // 第 1 档容量：显示床号 1 ~ 117
const RANGE_ERROR = { error: `床号要在 1~${BED_COUNT} 之间` };

describe('动作行的床号输入（显示床号 → 内部床号）', () => {
  it('合法输入换算成内部值：显示 1 = 内部 0，显示 13 = 内部 12', () => {
    expect(parseJumpTarget('1', BED_COUNT)).toEqual({ bedNo: 0 });
    expect(parseJumpTarget('13', BED_COUNT)).toEqual({ bedNo: 12 });
  });

  it('上边界就是 bedCount 本身：能到；再大一位给可见文案', () => {
    expect(parseJumpTarget(String(BED_COUNT), BED_COUNT)).toEqual({ bedNo: BED_COUNT - 1 });
    expect(parseJumpTarget(String(BED_COUNT + 1), BED_COUNT)).toEqual(RANGE_ERROR);
  });

  it('`0` 与空串都不合法（`Number(\'\')` 是 0，不能让空输入变成 1 号床）', () => {
    expect(parseJumpTarget('0', BED_COUNT)).toEqual(RANGE_ERROR);
    expect(parseJumpTarget('', BED_COUNT)).toEqual(RANGE_ERROR);
  });

  it('非数字不合法', () => {
    expect(parseJumpTarget('abc', BED_COUNT)).toEqual(RANGE_ERROR);
  });

  it('前后空格照常认（粘贴进来的床号会带空格）', () => {
    expect(parseJumpTarget('  13 ', BED_COUNT)).toEqual({ bedNo: 12 });
  });
});