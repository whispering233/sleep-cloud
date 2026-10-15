import { describe, expect, it } from 'vitest';

import { advanceMover, moverPosition, tileCenter } from '../movement';
import type { MoverState } from '../movement';

const STEP = 250;

function mover(path: Array<{ x: number; y: number }>): MoverState {
  return { x: 0, y: 0, path, legElapsedMs: 0 };
}

const straight = [
  { x: 0, y: 1 },
  { x: 0, y: 2 },
  { x: 0, y: 3 },
  { x: 0, y: 4 },
];

describe('按实际经过的时间推进（不是按拍数）', () => {
  it('不到一格的时长不动，累计够了才走一格', () => {
    const state = mover([...straight]);
    expect(advanceMover(state, 100, STEP)).toEqual({ moved: false, arrived: false });
    expect(state).toMatchObject({ x: 0, y: 0, legElapsedMs: 100 });

    expect(advanceMover(state, 150, STEP)).toEqual({ moved: true, arrived: false });
    expect(state).toMatchObject({ x: 0, y: 1, legElapsedMs: 0 });
  });

  it('节拍抖动不影响速度：一次给足 4 格的时间就走 4 格', () => {
    const jittery = mover([...straight]);
    // 抖动的节拍：30ms、70ms、100ms… 合计 1000ms，应当正好走完 4 格
    for (const elapsed of [30, 70, 10, 90, 5, 145, 100, 250, 300]) {
      advanceMover(jittery, elapsed, STEP);
    }
    expect(jittery).toMatchObject({ x: 0, y: 4, legElapsedMs: 0 });
  });

  it('事件循环被阻塞一大截：一次性补齐，速度不变', () => {
    const blocked = mover([...straight]);
    const result = advanceMover(blocked, 1000, STEP); // 一次吞掉 4 拍
    expect(result).toEqual({ moved: true, arrived: true });
    expect(blocked).toMatchObject({ x: 0, y: 4, legElapsedMs: 0 });
  });

  it('走完就不再多走，也不会留下残余时长', () => {
    const done = mover([...straight]);
    advanceMover(done, 5000, STEP);
    expect(done).toMatchObject({ x: 0, y: 4, legElapsedMs: 0 });
    expect(advanceMover(done, 5000, STEP)).toEqual({ moved: false, arrived: true });
  });

  it('负数或零时长不动（时钟回拨之类的防御）', () => {
    const state = mover([...straight]);
    expect(advanceMover(state, 0, STEP)).toEqual({ moved: false, arrived: false });
    expect(advanceMover(state, -500, STEP)).toEqual({ moved: false, arrived: false });
    expect(state).toMatchObject({ x: 0, y: 0 });
  });
});

describe('移动者的世界像素位置（不量化到格）', () => {
  it('格心 = 格号 × 一格 + 半格', () => {
    expect(tileCenter({ x: 0, y: 0 })).toEqual({ x: 16, y: 16 });
    expect(tileCenter({ x: 3, y: 2 })).toEqual({ x: 112, y: 80 });
  });

  it('本格内按已走时间给小数：整格是格心，半格是半格', () => {
    const state = mover([...straight]);
    expect(moverPosition(state, STEP)).toEqual({ x: 16, y: 16 }); // 本格刚起步

    advanceMover(state, STEP / 2, STEP); // 半格：0→1 的半路
    expect(moverPosition(state, STEP)).toEqual({ x: 16, y: 32 });

    advanceMover(state, STEP, STEP); // 再走满一格：累计一格半，正在走 1→2 的半路
    expect(moverPosition(state, STEP)).toEqual({ x: 16, y: 64 });
  });

  it('走完（路径空）就是最终格心，不拖尾巴', () => {
    const state = mover([{ x: 0, y: 1 }]);
    advanceMover(state, STEP, STEP);
    expect(moverPosition(state, STEP)).toEqual({ x: 16, y: 48 });
  });

  it('走路开始时求出的位置就是当前格心：客户端据此开的窗口两端同点，起步不瞬移', () => {
    const state = mover([...straight]);
    expect(moverPosition(state, STEP)).toEqual(tileCenter({ x: state.x, y: state.y }));
  });
});
