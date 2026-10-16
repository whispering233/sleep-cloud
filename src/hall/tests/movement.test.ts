import { describe, expect, it } from 'vitest';

import { advanceMover, moverPosition } from '../movement';
import type { MoverState } from '../movement';

/** 一条先横后竖的折线（街网路径本来就只有轴对齐的段）。 */
function mover(path: Array<{ x: number; y: number }>): MoverState {
  return { x: 0, y: 0, path };
}

describe('按实际经过的时间推进（不是按拍数，也不量化到格）', () => {
  it('位置是连续像素：100ms 走 22px，不是整格', () => {
    const state = mover([{ x: 130, y: 0 }]);
    expect(advanceMover(state, 100)).toEqual({ moved: true, arrived: false });
    expect(moverPosition(state)).toEqual({ x: 22, y: 0 });
  });

  it('节拍抖动不影响速度：把同样的总时长拆成多拍，位移一致', () => {
    const jittery = mover([{ x: 220, y: 0 }]);
    for (const elapsed of [30, 70, 10, 90, 5, 145, 100, 250, 300]) {
      advanceMover(jittery, elapsed);
    }
    expect(moverPosition(jittery)).toEqual({ x: 220, y: 0 }); // 合计 1000ms × 220px/s

    const steady = mover([{ x: 220, y: 0 }]);
    advanceMover(steady, 1000);
    expect(moverPosition(steady)).toEqual({ x: 220, y: 0 });
  });

  it('事件循环被阻塞一大截：一次性补齐，速度不变（并且不会越过途经点）', () => {
    const blocked = mover([
      { x: 100, y: 0 },
      { x: 100, y: 200 },
    ]);
    const result = advanceMover(blocked, 1000); // 220px：先走完 100，再走 120
    expect(result).toEqual({ moved: true, arrived: false });
    expect(moverPosition(blocked)).toEqual({ x: 100, y: 120 });
  });

  it('走完整条折线就到达，且不再多走（没有残留的“本格进度”）', () => {
    const state = mover([
      { x: 50, y: 0 },
      { x: 50, y: 50 },
    ]);
    expect(advanceMover(state, 10_000)).toEqual({ moved: true, arrived: true });
    expect(moverPosition(state)).toEqual({ x: 50, y: 50 });
    expect(state.path).toEqual([]);
    expect(advanceMover(state, 10_000)).toEqual({ moved: false, arrived: true });
  });

  it('刚好走完的边界不算“到达前一刻”', () => {
    const state = mover([{ x: 22, y: 0 }]);
    expect(advanceMover(state, 100)).toEqual({ moved: true, arrived: true });
  });

  it('负数或零时长不动（时钟回拨之类的防御）', () => {
    const state = mover([{ x: 130, y: 0 }]);
    expect(advanceMover(state, 0)).toEqual({ moved: false, arrived: false });
    expect(advanceMover(state, -500)).toEqual({ moved: false, arrived: false });
    expect(moverPosition(state)).toEqual({ x: 0, y: 0 });
  });

  it('空路径：原地不动，且立刻算「到达」（复合意图的“原地躺下”靠它）', () => {
    const state = mover([]);
    expect(advanceMover(state, 1000)).toEqual({ moved: false, arrived: true });
    expect(moverPosition(state)).toEqual({ x: 0, y: 0 });
  });

  it('速度是显式参数（默认 220px/s），单位是「世界像素/秒」', () => {
    const state = mover([{ x: 1000, y: 0 }]);
    advanceMover(state, 1000, 500);
    expect(moverPosition(state)).toEqual({ x: 500, y: 0 });
  });

  it('位置允许小数（半像素）：客户端按服务端时间戳插值，不按格号', () => {
    const state = mover([{ x: 61, y: 0 }]);
    advanceMover(state, 75); // 16.5px
    expect(moverPosition(state)).toEqual({ x: 16.5, y: 0 });
  });
});