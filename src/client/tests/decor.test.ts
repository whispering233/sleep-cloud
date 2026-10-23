import { describe, expect, it } from 'vitest';

import {
  DECOR_BLOCK_ORDER,
  DECOR_BLOCKS,
  DEFAULT_DECOR,
  NO_DECOR_LABEL,
  blockLabel,
  decorLabel,
  decorOptionsOf,
  isDecorChoice,
} from '../decor';
import type { DecorBlock, DecorValue } from '../decor';

/**
 * 装饰的纯函数层（`docs/design/80-reserve-decor.md` §4 / §6）：
 * 默认值落在自己的候选里、候选 + `none`、文案覆盖所有候选、白名单**逐块**判。
 */

const BLOCKS: readonly DecorBlock[] = DECOR_BLOCK_ORDER;

describe('装饰候选表（DECOR_BLOCKS 是唯一真源）', () => {
  it('默认值每一块都落在**自己**那一块的候选里（两样都在 = 选择上线前的行为）', () => {
    for (const block of BLOCKS) {
      const value = DEFAULT_DECOR[block];
      expect(value).not.toBe('none');
      expect(DECOR_BLOCKS[block]).toContain(value);
    }
    expect(DEFAULT_DECOR).toEqual({ head: 'fire', foot: 'cat' });
  });

  it('块清单与候选表的键一致：没有第三块（中间块还没有候选，所以不进数据也不进界面）', () => {
    expect([...BLOCKS].sort()).toEqual(Object.keys(DECOR_BLOCKS).sort());
    expect(BLOCKS).toEqual(['head', 'foot']);
  });

  it('每块至少一个候选，且同一块的候选互不重复（块内互斥靠形状保证）', () => {
    for (const block of BLOCKS) {
      const ids = DECOR_BLOCKS[block] as readonly string[];
      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
      // `none` 不在候选表里：它是「没有装饰」，对每块都合法，不属于任何一块的候选
      expect(ids).not.toContain('none');
    }
  });
});

describe('文案', () => {
  it('每样装饰都有中文名（加 id 忘加文案 = 这里会读到 undefined）', () => {
    expect(decorLabel('fire')).toBe('篝火');
    expect(decorLabel('cat')).toBe('猫');
    for (const block of BLOCKS) {
      for (const id of DECOR_BLOCKS[block]) expect(decorLabel(id).length).toBeGreaterThan(0);
    }
  });

  it('每块都有标题：床头 / 床尾', () => {
    expect(blockLabel('head')).toBe('床头');
    expect(blockLabel('foot')).toBe('床尾');
  });

  it('「无装饰」有自己的文案（它是一等值，不靠「再点一次取消」）', () => {
    expect(NO_DECOR_LABEL).toBe('无装饰');
  });
});

describe('decorOptionsOf：候选 + none', () => {
  it('每块 = 该块候选 + 末尾一个 `none`（界面按它遍历，加一样装饰自动多一行）', () => {
    for (const block of BLOCKS) {
      const options = decorOptionsOf(block);
      const expected: DecorValue<DecorBlock>[] = [...DECOR_BLOCKS[block], 'none'];
      expect(options.map((option) => option.id)).toEqual(expected);
      // 每块末尾都是「无装饰」，文案也一致
      expect(options.at(-1)).toEqual({ id: 'none', label: NO_DECOR_LABEL });
    }
  });

  it('每一项的文案都非空，候选项用 decorLabel 那一份', () => {
    for (const block of BLOCKS) {
      for (const option of decorOptionsOf(block)) {
        expect(option.label.length).toBeGreaterThan(0);
        if (option.id !== 'none') expect(option.label).toBe(decorLabel(option.id));
      }
    }
  });
});

describe('逐块白名单 isDecorChoice', () => {
  it('该块的候选与 `none` 都通过', () => {
    expect(isDecorChoice('head', 'fire')).toBe(true);
    expect(isDecorChoice('foot', 'cat')).toBe(true);
    expect(isDecorChoice('head', 'none')).toBe(true);
    expect(isDecorChoice('foot', 'none')).toBe(true);
  });

  it('表外 id 不通过（包被删了 / 还没上线的那一样）', () => {
    expect(isDecorChoice('head', 'lamp')).toBe(false);
    expect(isDecorChoice('foot', 'dog')).toBe(false);
    expect(isDecorChoice('head', '')).toBe(false);
  });

  it('**跨块 id 不通过**：猫不能存进床头块、篝火不能存进床尾块', () => {
    expect(isDecorChoice('head', 'cat')).toBe(false);
    expect(isDecorChoice('foot', 'fire')).toBe(false);
  });

  it('非字符串一概不通过（数字 / `null` / 布尔 / 对象 / 数组）', () => {
    for (const value of [0, 1, null, undefined, true, {}, [], ['fire']]) {
      expect(isDecorChoice('head', value)).toBe(false);
      expect(isDecorChoice('foot', value)).toBe(false);
    }
  });
});
